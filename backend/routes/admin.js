const fs = require('fs');
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const excel = require('../services/excelService');
const scoring = require('../services/scoringService');
const { attemptInfo } = require('./exam');
const { resultCard } = require('./result');

const router = express.Router();

const STATUSES = ['Active', 'Closed', 'Results Released'];
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function num(v, fallback) {
  const n = Number(v);
  return v === '' || v === null || v === undefined || Number.isNaN(n) ? fallback : n;
}

function clean(v, max = 5000) {
  return String(v ?? '').trim().slice(0, max);
}

function loadExam(id) {
  const exam = excel.getExam(id);
  if (!exam) throw httpError(404, 'Exam not found');
  return exam;
}

function normalizeThresholds(t = {}) {
  const d = config.defaultThresholds;
  const out = {};
  for (const k of Object.keys(d)) out[k] = Math.min(100, Math.max(0, num(t[k], d[k])));
  return out;
}

function normalizeMeta(body, existing = {}) {
  const meta = {
    title: clean(body.title, 200),
    team: clean(body.team, 200),
    site: clean(body.site, 200),
    examDate: clean(body.examDate, 20),
    instructions: clean(body.instructions, 20000),
    instructionsHi: clean(body.instructionsHi, 20000),
    unlockDays: Math.max(0, num(body.unlockDays, config.defaultUnlockDays)),
    estimatedMinutes: body.estimatedMinutes === '' || body.estimatedMinutes == null ? null : Math.max(1, num(body.estimatedMinutes, 60)),
    status: STATUSES.includes(body.status) ? body.status : existing.status || 'Active',
    thresholds: normalizeThresholds(body.thresholds || existing.thresholds),
  };
  if (!meta.title) throw httpError(400, 'Exam title is required');
  return meta;
}

function normalizeSections(sections) {
  if (!Array.isArray(sections) || !sections.length) throw httpError(400, 'Add at least one section');
  return sections.map((s, si) => {
    const name = clean(s.name, 200);
    if (!name) throw httpError(400, `Section ${si + 1} needs a name`);
    const questions = (s.questions || []).map((q, qi) => {
      const where = `Section ${si + 1}, question ${qi + 1}`;
      const options = excel.OPTIONS.map((_, oi) => {
        const o = (q.options || [])[oi] || {};
        return { en: clean(o.en, 2000), hi: clean(o.hi, 2000) };
      });
      const correct = clean(q.correct, 1).toUpperCase();
      if (!clean(q.textEn)) throw httpError(400, `${where}: English question text is required`);
      if (options.some((o) => !o.en)) throw httpError(400, `${where}: all four English options are required`);
      if (!excel.OPTIONS.includes(correct)) throw httpError(400, `${where}: correct option must be A, B, C or D`);
      return {
        qid: clean(q.qid, 40),
        type: clean(q.type, 40).toUpperCase(),
        category: clean(q.category, 200),
        textEn: clean(q.textEn),
        textHi: clean(q.textHi),
        options,
        correct,
        explanation: clean(q.explanation),
      };
    });
    return {
      name,
      nameHi: clean(s.nameHi, 200),
      description: clean(s.description, 5000),
      descriptionHi: clean(s.descriptionHi, 5000),
      questions,
    };
  });
}

function examStats(exam) {
  const assigned = excel.getAssignments().filter((a) => a.examId === exam.id);
  const attempts = excel.getAttempts(exam.id);
  return {
    participants: assigned.length,
    submitted: attempts.filter((a) => a.status === 'submitted').length,
    inProgress: attempts.filter((a) => a.status === 'in_progress').length,
  };
}

function bankForEditor(exam) {
  const bank = excel.getQuestionBank(exam);
  return bank.sections.map((s) => ({
    name: s.name,
    nameHi: s.nameHi,
    description: s.description,
    descriptionHi: s.descriptionHi,
    questions: bank.questions
      .filter((q) => q.sectionNo === s.no)
      .map((q) => ({
        qid: q.qid,
        type: q.type,
        category: q.category,
        textEn: q.textEn,
        textHi: q.textHi,
        options: q.options.map((o) => ({ en: o.en, hi: o.hi })),
        correct: q.correct,
        explanation: q.explanation,
      })),
  }));
}

async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}

// ---------------------------------------------------------------- exams

router.get('/exams', (req, res) => {
  const exams = excel
    .getExams()
    .map((e) => {
      const bank = excel.getQuestionBank(e);
      return { ...e, questionCount: bank.questions.length, sectionCount: bank.sections.length, ...examStats(e) };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ exams });
});

router.post('/exams', (req, res) => {
  const meta = normalizeMeta(req.body || {});
  const sections = normalizeSections((req.body || {}).sections);
  excel.ensureDirs();
  const exam = {
    id: `EX${Date.now().toString(36).toUpperCase()}`,
    ...meta,
    fileName: excel.examFileName(meta.title, meta.examDate),
    createdAt: new Date().toISOString(),
  };
  excel.saveExam(exam);
  excel.saveQuestionBank(exam, sections);
  res.status(201).json({ exam });
});

router.get('/exams/:id', (req, res) => {
  const exam = loadExam(req.params.id);
  res.json({ exam: { ...exam, ...examStats(exam) }, sections: bankForEditor(exam) });
});

router.put('/exams/:id', (req, res) => {
  const existing = loadExam(req.params.id);
  const meta = normalizeMeta(req.body || {}, existing);
  const exam = { ...existing, ...meta };
  if (req.body.sections) excel.saveQuestionBank(exam, normalizeSections(req.body.sections));
  excel.saveExam(exam);
  // Thresholds may have changed — refresh remarks already written to Excel.
  const summary = excel.getSummaryRows(exam);
  if (summary.length) excel.rewriteSummary(exam, scoring.refreshRemarks(summary, exam.thresholds), scoring.buildAnalyticsSheet);
  res.json({ exam });
});

router.patch('/exams/:id/status', (req, res) => {
  const exam = loadExam(req.params.id);
  if (!STATUSES.includes(req.body.status)) throw httpError(400, 'Invalid status');
  exam.status = req.body.status;
  excel.saveExam(exam);
  res.json({ exam });
});

router.delete('/exams/:id', (req, res) => {
  const exam = loadExam(req.params.id);
  excel.deleteExamFiles(exam);
  excel.deleteExamRecord(exam.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- participants per exam

router.get('/exams/:id/participants', (req, res) => {
  const exam = loadExam(req.params.id);
  const users = new Map(excel.getUsers().map((u) => [u.username, u]));
  const attempts = new Map(excel.getAttempts(exam.id).map((a) => [a.username, a]));
  const participants = excel
    .getAssignments()
    .filter((a) => a.examId === exam.id)
    .map((a) => {
      const attempt = attempts.get(a.username);
      const info = attemptInfo(exam, attempt);
      const r = attempt && attempt.result;
      return {
        username: a.username,
        name: (users.get(a.username) || {}).name || a.username,
        assignedAt: a.assignedAt,
        ...info,
        totalPct: r ? r.totalPct : null,
        correct: r ? r.correct : null,
        total: r ? r.total : null,
        totalSeconds: r ? r.totalSeconds : null,
        sections: r ? r.sections.map((s) => ({ no: s.no, name: s.name, pct: s.pct })) : [],
        knowledgePct: r ? r.knowledgePct : null,
        behaviourPct: r ? r.behaviourPct : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ participants });
});

router.delete('/exams/:id/participants/:username', (req, res) => {
  const exam = loadExam(req.params.id);
  excel.unassign(exam.id, req.params.username);
  res.json({ ok: true });
});

/** Admin can wipe a participant's attempt so they can retake the exam. */
router.delete('/exams/:id/attempts/:username', (req, res) => {
  const exam = loadExam(req.params.id);
  const username = excel.normalizeUsername(req.params.username);
  excel.deleteAttempt(exam.id, username);
  excel.removeSubmission(exam, username, scoring.buildAnalyticsSheet);
  res.json({ ok: true });
});

router.get('/exams/:id/results/:username', (req, res) => {
  const exam = loadExam(req.params.id);
  const username = excel.normalizeUsername(req.params.username);
  const attempt = excel.getAttempt(exam.id, username);
  if (!attempt || !attempt.result) throw httpError(404, 'No submission');
  const responses = excel.getResponseRows(exam).filter((r) => String(r.Username) === username);
  res.json({ result: resultCard(exam, attempt), attempt: attemptInfo(exam, attempt), responses });
});

router.get('/exams/:id/analytics', (req, res) => {
  const exam = loadExam(req.params.id);
  res.json({ analytics: scoring.computeAnalytics(excel.getSummaryRows(exam), excel.getResponseRows(exam)) });
});

router.get('/exams/:id/download', (req, res) => {
  const exam = loadExam(req.params.id);
  // Regenerate remarks + Analytics so the download is always current.
  const summary = excel.getSummaryRows(exam);
  excel.rewriteSummary(exam, scoring.refreshRemarks(summary, exam.thresholds), scoring.buildAnalyticsSheet);
  const buf = excel.examWorkbookBuffer(exam);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${exam.fileName.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(exam.fileName)}`,
  );
  res.send(buf);
});

// ---------------------------------------------------------------- users

router.get('/users', (req, res) => {
  const assignments = excel.getAssignments();
  const users = excel.getUsers().map((u) => ({
    username: u.username,
    name: u.name,
    createdAt: u.createdAt,
    examIds: assignments.filter((a) => a.username === u.username).map((a) => a.examId),
  }));
  res.json({ users });
});

/** Add (or update) a participant and optionally assign them to one exam. */
router.post('/participants', async (req, res) => {
  const username = excel.normalizeUsername(req.body.username);
  const name = clean(req.body.name, 200);
  const password = String(req.body.password || '');
  const examId = clean(req.body.examId, 40);
  if (!USERNAME_RE.test(username) || username === config.adminUsername) {
    throw httpError(400, 'Username must be 3–40 characters: letters, digits, dot, dash or underscore');
  }
  const existing = excel.getUser(username);
  if (!existing && (!name || !password)) throw httpError(400, 'Name and password are required for a new participant');
  if (password && password.length < 4) throw httpError(400, 'Password must be at least 4 characters');
  if (examId) loadExam(examId);
  excel.upsertUser({ username, name, passwordHash: password ? await hashPassword(password) : '' });
  if (examId) excel.assign(examId, username);
  res.status(existing ? 200 : 201).json({ ok: true, created: !existing });
});

router.post('/participants/bulk', async (req, res) => {
  const examId = clean(req.body.examId, 40);
  if (examId) loadExam(examId);
  let records;
  try {
    records = excel.parseCsv(String(req.body.csv || ''));
  } catch {
    throw httpError(400, 'Could not read the CSV');
  }
  const known = new Set(excel.getUsers().map((u) => u.username));
  const errors = [];
  const toSave = [];
  const seen = new Set();
  for (const [i, raw] of records.entries()) {
    const rec = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), String(v).trim()]));
    const line = i + 2;
    const username = excel.normalizeUsername(rec.username);
    if (!USERNAME_RE.test(username) || username === config.adminUsername) {
      errors.push(`Line ${line}: invalid username "${rec.username || ''}"`);
      continue;
    }
    if (seen.has(username)) {
      errors.push(`Line ${line}: duplicate username "${username}"`);
      continue;
    }
    if (!known.has(username) && (!rec.name || !rec.password)) {
      errors.push(`Line ${line}: name and password are required for new user "${username}"`);
      continue;
    }
    if (rec.password && rec.password.length < 4) {
      errors.push(`Line ${line}: password too short for "${username}"`);
      continue;
    }
    seen.add(username);
    toSave.push({ username, name: rec.name, password: rec.password });
  }
  const hashed = [];
  for (const u of toSave) {
    hashed.push({ username: u.username, name: u.name, passwordHash: u.password ? await hashPassword(u.password) : '' });
  }
  if (hashed.length) excel.upsertUsers(hashed);
  const assigned = examId && hashed.length ? excel.assign(examId, hashed.map((u) => u.username)) : 0;
  res.json({
    created: hashed.filter((u) => !known.has(u.username)).length,
    updated: hashed.filter((u) => known.has(u.username)).length,
    assigned,
    errors,
  });
});

router.post('/users/:username/assign', (req, res) => {
  const user = excel.getUser(req.params.username);
  if (!user) throw httpError(404, 'User not found');
  const exam = loadExam(clean(req.body.examId, 40));
  excel.assign(exam.id, user.username);
  res.json({ ok: true });
});

router.delete('/users/:username', (req, res) => {
  excel.deleteUser(req.params.username);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- logo

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

router.post('/logo', (req, res) => {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(req.body.dataUrl || ''));
  if (!m || !LOGO_TYPES.includes(m[1])) throw httpError(400, 'Logo must be a PNG, JPEG, GIF or WebP image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1024 * 1024) throw httpError(400, 'Logo must be under 1 MB');
  excel.ensureDirs();
  fs.writeFileSync(config.logoFile, buf);
  excel.setSetting('logoType', m[1]);
  excel.setSetting('logoVersion', String(Date.now()));
  res.json({ ok: true });
});

router.delete('/logo', (req, res) => {
  try {
    fs.unlinkSync(config.logoFile);
  } catch {
    /* no logo */
  }
  excel.setSetting('logoType', '');
  excel.setSetting('logoVersion', '');
  res.json({ ok: true });
});

module.exports = router;
