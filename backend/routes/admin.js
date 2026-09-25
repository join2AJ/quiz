const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const store = require('../services/store');
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

async function loadExam(id) {
  const exam = await store.getExam(id);
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

async function examStats(exam, assignments) {
  const assigned = (assignments || (await store.getAssignments())).filter((a) => a.examId === exam.id);
  const attempts = await store.getAttempts(exam.id);
  return {
    participants: assigned.length,
    submitted: attempts.filter((a) => a.status === 'submitted').length,
    inProgress: attempts.filter((a) => a.status === 'in_progress').length,
  };
}

async function bankForEditor(exam) {
  const bank = await store.getQuestionBank(exam);
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

router.get('/exams', async (req, res) => {
  const [all, assignments] = await Promise.all([store.getExams(), store.getAssignments()]);
  const exams = (
    await Promise.all(
      all.map(async (e) => {
        const [bank, stats] = await Promise.all([store.getQuestionBank(e), examStats(e, assignments)]);
        return { ...e, questionCount: bank.questions.length, sectionCount: bank.sections.length, ...stats };
      }),
    )
  ).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ exams });
});

router.post('/exams', async (req, res) => {
  const meta = normalizeMeta(req.body || {});
  const sections = normalizeSections((req.body || {}).sections);
  const exam = {
    id: `EX${Date.now().toString(36).toUpperCase()}`,
    ...meta,
    fileName: '',
    createdAt: new Date().toISOString(),
  };
  await store.saveExam(exam);
  await store.saveQuestionBank(exam, sections);
  res.status(201).json({ exam });
});

router.get('/exams/:id', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const [stats, sections] = await Promise.all([examStats(exam), bankForEditor(exam)]);
  res.json({ exam: { ...exam, ...stats }, sections });
});

router.put('/exams/:id', async (req, res) => {
  const existing = await loadExam(req.params.id);
  const meta = normalizeMeta(req.body || {}, existing);
  const exam = { ...existing, ...meta };
  const sections = req.body.sections ? normalizeSections(req.body.sections) : null;
  await store.saveExam(exam);
  if (sections) await store.saveQuestionBank(exam, sections);
  // Thresholds may have changed — refresh remarks already stored.
  const summary = await store.getSummaryRows(exam);
  if (summary.length) await store.rewriteSummary(exam, scoring.refreshRemarks(summary, exam.thresholds), scoring.buildAnalyticsSheet);
  res.json({ exam });
});

router.patch('/exams/:id/status', async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (!STATUSES.includes(req.body.status)) throw httpError(400, 'Invalid status');
  exam.status = req.body.status;
  await store.saveExam(exam);
  res.json({ exam });
});

router.delete('/exams/:id', async (req, res) => {
  const exam = await loadExam(req.params.id);
  await store.deleteExam(exam);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- participants per exam

router.get('/exams/:id/participants', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const [userList, attemptList, assignments] = await Promise.all([
    store.getUsers(),
    store.getAttempts(exam.id),
    store.getAssignments(),
  ]);
  const users = new Map(userList.map((u) => [u.username, u]));
  const attempts = new Map(attemptList.map((a) => [a.username, a]));
  const participants = assignments
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

router.delete('/exams/:id/participants/:username', async (req, res) => {
  const exam = await loadExam(req.params.id);
  await store.unassign(exam.id, req.params.username);
  res.json({ ok: true });
});

/** Admin can wipe a participant's attempt so they can retake the exam. */
router.delete('/exams/:id/attempts/:username', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const username = excel.normalizeUsername(req.params.username);
  await store.deleteAttempt(exam.id, username);
  await store.removeSubmission(exam, username, scoring.buildAnalyticsSheet);
  res.json({ ok: true });
});

router.get('/exams/:id/results/:username', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const username = excel.normalizeUsername(req.params.username);
  const attempt = await store.getAttempt(exam.id, username);
  if (!attempt || !attempt.result) throw httpError(404, 'No submission');
  const responses = await store.getResponseRows(exam, username);
  res.json({ result: resultCard(exam, attempt), attempt: attemptInfo(exam, attempt), responses });
});

router.get('/exams/:id/analytics', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const [summary, responses] = await Promise.all([store.getSummaryRows(exam), store.getResponseRows(exam)]);
  res.json({ analytics: scoring.computeAnalytics(summary, responses) });
});

router.get('/exams/:id/download', async (req, res) => {
  const exam = await loadExam(req.params.id);
  // Build the workbook fresh (current remarks + Analytics) from the active store.
  const [rawSummary, responses, bank] = await Promise.all([
    store.getSummaryRows(exam),
    store.getResponseRows(exam),
    store.getQuestionBank(exam),
  ]);
  const summary = scoring.refreshRemarks(rawSummary, exam.thresholds);
  const buf = excel.buildResultsWorkbook({
    summary,
    responses,
    bank,
    analyticsAoa: scoring.buildAnalyticsSheet(summary, responses),
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${exam.fileName.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(exam.fileName)}`,
  );
  res.send(buf);
});

// ---------------------------------------------------------------- users

router.get('/users', async (req, res) => {
  const [assignments, userList] = await Promise.all([store.getAssignments(), store.getUsers()]);
  const users = userList.map((u) => ({
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
  const existing = await store.getUser(username);
  if (!existing && (!name || !password)) throw httpError(400, 'Name and password are required for a new participant');
  if (password && password.length < 4) throw httpError(400, 'Password must be at least 4 characters');
  if (examId) await loadExam(examId);
  await store.upsertUsers([{ username, name, passwordHash: password ? await hashPassword(password) : '' }]);
  if (examId) await store.assign(examId, username);
  res.status(existing ? 200 : 201).json({ ok: true, created: !existing });
});

router.post('/participants/bulk', async (req, res) => {
  const examId = clean(req.body.examId, 40);
  if (examId) await loadExam(examId);
  // The frontend uploads big CSVs in batches; lineOffset keeps error line numbers right.
  const lineOffset = Math.max(0, Math.floor(num(req.body.lineOffset, 0)));
  let records;
  try {
    records = excel.parseCsv(String(req.body.csv || ''));
  } catch {
    throw httpError(400, 'Could not read the CSV');
  }
  if (records.length > 50) throw httpError(400, 'Upload at most 50 rows per request');
  const known = new Set((await store.getUsers()).map((u) => u.username));
  const errors = [];
  const toSave = [];
  const seen = new Set();
  for (const [i, raw] of records.entries()) {
    const rec = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase(), String(v).trim()]));
    const line = i + 2 + lineOffset;
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
  if (hashed.length) await store.upsertUsers(hashed);
  const assigned = examId && hashed.length ? await store.assign(examId, hashed.map((u) => u.username)) : 0;
  res.json({
    created: hashed.filter((u) => !known.has(u.username)).length,
    updated: hashed.filter((u) => known.has(u.username)).length,
    assigned,
    errors,
  });
});

router.post('/users/:username/assign', async (req, res) => {
  const user = await store.getUser(req.params.username);
  if (!user) throw httpError(404, 'User not found');
  const exam = await loadExam(clean(req.body.examId, 40));
  await store.assign(exam.id, user.username);
  res.json({ ok: true });
});

router.delete('/users/:username', async (req, res) => {
  await store.deleteUser(req.params.username);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- logo

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

router.post('/logo', async (req, res) => {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(req.body.dataUrl || ''));
  if (!m || !LOGO_TYPES.includes(m[1])) throw httpError(400, 'Logo must be a PNG, JPEG, GIF or WebP image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1024 * 1024) throw httpError(400, 'Logo must be under 1 MB');
  await store.setLogo(m[1], buf);
  await store.setSetting('logoVersion', String(Date.now()));
  res.json({ ok: true });
});

router.delete('/logo', async (req, res) => {
  await store.deleteLogo();
  await store.setSetting('logoVersion', '');
  res.json({ ok: true });
});

module.exports = router;
