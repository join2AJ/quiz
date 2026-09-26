const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const store = require('../services/store');
const excel = require('../services/excelService');
const scoring = require('../services/scoringService');
const audit = require('../services/auditService');
const { attemptInfo, finishAttempt, isLive, waitingRoom } = require('./exam');
const examClock = require('../services/examClock');
const presence = require('../services/presenceService');
const { parseRoleLines, DEFAULT_ROLES } = require('../services/roles');
const { resultCard } = require('./result');
const leadership = require('../services/leadershipService');

const cache = require('../services/cache');

const router = express.Router();

// Any admin change (exam, questions, status, assignments) clears this
// instance's exam cache so it takes effect immediately here.
router.use((req, res, next) => {
  if (req.method !== 'GET') cache.clear();
  next();
});

const STATUSES = ['Active', 'Closed', 'Results Released'];
// Netlify Functions return at most ~6 MB (base64-encoded), so keep files below ~4.3 MB.
const MAX_DOWNLOAD_BYTES = 4.3 * 1024 * 1024;
const CLICK_EVENTS = ['QUESTION_VIEW', 'NAVIGATION', 'ANSWER_SELECT'];
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

const TYPES = ['KNOWLEDGE', 'BEHAVIOUR'];

/** Per-exam scoring/display config: partial credit, suggested time, remark rules, dimension labels. */
function normalizeConfig(input, existing = {}) {
  const c = input && typeof input === 'object' ? input : existing || {};
  const out = {};
  out.partialCreditPct = Math.min(100, Math.max(0, num(c.partialCreditPct, 50)));
  out.timerSeconds = {};
  for (const t of TYPES) {
    const v = num((c.timerSeconds || {})[t], 0);
    if (v > 0) out.timerSeconds[t] = Math.min(3600, Math.round(v));
  }
  out.remarkRules = (Array.isArray(c.remarkRules) ? c.remarkRules : [])
    .map((r) => ({ condition: clean(r.condition, 500), en: clean(r.en, 2000), hi: clean(r.hi, 2000) }))
    .filter((r) => r.condition || r.en || r.hi);
  const err = scoring.validateRemarkRules(out.remarkRules);
  if (err) throw httpError(400, err);
  // Participants see "Part 1, Part 2…" unless this is turned on.
  out.showSectionNames = !!c.showSectionNames;
  out.dimensions = {};
  for (const [key, d] of Object.entries(c.dimensions || {})) {
    const k = clean(key, 60).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (k) out.dimensions[k] = { label: clean(d && d.label, 120), labelHi: clean(d && d.labelHi, 120) };
  }
  // Waiting room (on unless turned off); the start time is set by "Start exam".
  out.waitingRoom = c.waitingRoom !== false;
  out.liveAt = (existing && existing.liveAt) || null;
  // Time limits per part (on unless turned off).
  out.timeLimits = c.timeLimits !== false;
  out.sectionExtraMinutes = Math.min(60, Math.max(0, num(c.sectionExtraMinutes, 5)));
  out.examExtraMinutes = Math.min(60, Math.max(0, num(c.examExtraMinutes, 5)));
  // Participants see every question with the correct answer once results are out.
  out.showAnswersInResult = c.showAnswersInResult !== false;
  // Work participants can tick at the end ("English | Hindi" lines or a list).
  if (typeof c.rolesText === 'string') {
    const parsed = parseRoleLines(c.rolesText.split('\n'));
    out.roles = parsed.length ? parsed : null;
  } else if (Array.isArray(c.roles) && c.roles.length) {
    out.roles = c.roles.map((r) => ({ key: clean(r.key, 40), en: clean(r.en, 120), hi: clean(r.hi, 120) })).filter((r) => r.key && r.en);
  } else out.roles = null;
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
    config: normalizeConfig(body.config, existing.config),
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
      const meta = excel.questionMeta({ ...q, correct });
      return {
        qid: clean(q.qid, 40),
        type: clean(q.type, 40).toUpperCase(),
        category: clean(q.category, 200),
        textEn: clean(q.textEn),
        textHi: clean(q.textHi),
        scenarioEn: clean(q.scenarioEn),
        scenarioHi: clean(q.scenarioHi),
        options,
        correct,
        explanation: clean(q.explanation),
        ...meta,
        dimension: clean(meta.dimension, 60).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        difficulty: clean(meta.difficulty, 20),
        explanationHi: clean(meta.explanationHi),
        tags: meta.tags.map((t) => clean(t, 60)).slice(0, 20),
        revealMap: Object.fromEntries(Object.entries(meta.revealMap).map(([k, v]) => [k, clean(v, 1000)])),
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
        scenarioEn: q.scenarioEn,
        scenarioHi: q.scenarioHi,
        options: q.options.map((o) => ({ en: o.en, hi: o.hi })),
        correct: q.correct,
        explanation: q.explanation,
        explanationHi: q.explanationHi,
        fullCredit: q.fullCredit.filter((l) => l !== q.correct),
        partial: q.partial,
        concern: q.concern,
        neutral: q.neutral,
        dimension: q.dimension,
        weight: q.weight,
        difficulty: q.difficulty,
        tags: q.tags,
        revealMap: q.revealMap,
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
  await audit.log(req, 'ADMIN_CREATE_EXAM', {
    admin_username: 'admin',
    exam_id: exam.id,
    exam_title: exam.title,
    team: exam.team,
    site: exam.site,
  });
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
  // Audit every scoring-related setting that changed.
  const watched = {
    thresholds: [existing.thresholds, exam.thresholds],
    unlock_days: [existing.unlockDays, exam.unlockDays],
    partial_credit_pct: [(existing.config || {}).partialCreditPct, exam.config.partialCreditPct],
    remark_rules: [(existing.config || {}).remarkRules || [], exam.config.remarkRules],
    timer_seconds: [(existing.config || {}).timerSeconds || {}, exam.config.timerSeconds],
  };
  for (const [field, [oldValue, newValue]] of Object.entries(watched)) {
    if (JSON.stringify(oldValue ?? null) !== JSON.stringify(newValue ?? null)) {
      await audit.log(req, 'ADMIN_CHANGE_THRESHOLD', {
        admin_username: 'admin',
        exam_id: exam.id,
        field_changed: field,
        old_value: oldValue ?? null,
        new_value: newValue ?? null,
      });
    }
  }
  // Thresholds / remark rules may have changed — refresh remarks already stored.
  const summary = await store.getSummaryRows(exam);
  if (summary.length) {
    const bank = await store.getQuestionBank(exam);
    await store.rewriteSummary(exam, scoring.refreshRemarks(summary, exam), (s2, r2) => scoring.buildAnalyticsSheet(s2, r2, bank, exam));
  }
  res.json({ exam });
});

router.patch('/exams/:id/status', async (req, res) => {
  const exam = await loadExam(req.params.id);
  if (!STATUSES.includes(req.body.status)) throw httpError(400, 'Invalid status');
  const oldStatus = exam.status;
  exam.status = req.body.status;
  await store.saveExam(exam);
  await audit.log(req, 'ADMIN_CHANGE_STATUS', { admin_username: 'admin', exam_id: exam.id, old_value: oldStatus, new_value: exam.status });
  res.json({ exam });
});

// Waiting room: start the exam for everyone waiting (or put it back to waiting).
router.post('/exams/:id/go-live', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const live = req.body && req.body.live !== false;
  exam.config = { ...(exam.config || {}), liveAt: live ? new Date().toISOString() : null };
  if (live && exam.status !== 'Active') exam.status = 'Active';
  await store.saveExam(exam);
  await audit.log(req, 'ADMIN_START_EXAM', { admin_username: 'admin', exam_id: exam.id, started: live });
  res.json({ exam });
});

// Show results to everyone now, without waiting for the unlock date.
router.post('/exams/:id/declare-results', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const oldStatus = exam.status;
  exam.status = 'Results Released';
  await store.saveExam(exam);
  await audit.log(req, 'ADMIN_DECLARE_RESULTS', { admin_username: 'admin', exam_id: exam.id, old_value: oldStatus, new_value: exam.status });
  res.json({ exam });
});

// Who is logged in, waiting, taking the exam or done — refreshed by the Live tab.
router.get('/exams/:id/live', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const [users, attempts, assignments, present, bank] = await Promise.all([
    store.getUsers(),
    store.getAttempts(exam.id),
    store.getAssignments(),
    presence.list(),
    store.getQuestionBank(exam),
  ]);
  const plan = examClock.plan(exam, bank);
  // Exams whose time ran out while the person was away are submitted now.
  for (const at of attempts) {
    if (at.status === 'in_progress' && examClock.expired(plan, at)) await finishAttempt(req, exam, at, { reason: 'time_over' });
  }
  const byUser = new Map(users.map((u) => [u.username, u]));
  const byAttempt = new Map(attempts.map((a) => [a.username, a]));
  const byPresence = new Map(present.map((p) => [p.username, p]));
  const now = Date.now();
  const people = assignments
    .filter((a) => a.examId === exam.id)
    .map((a) => {
      const u = byUser.get(a.username) || {};
      const at = byAttempt.get(a.username);
      const p = byPresence.get(a.username);
      const row = {
        username: a.username,
        name: u.name || a.username,
        designation: u.designation || '',
        shift: u.shift || '',
        login: !p ? 'never' : p.online ? 'online' : p.status === 'online' ? 'away' : p.status,
        device: p ? p.device : '',
        loginAt: p ? p.loginAt : null,
        lastSeen: p ? p.lastSeen : null,
        logoutAt: p ? p.logoutAt : null,
        stage: p && p.examId === exam.id ? p.stage : p ? 'home' : null,
        exam: at ? at.status : 'not_started',
        answered: at ? Object.values((at.state && at.state.q) || {}).filter((x) => x.answer).length : 0,
      };
      if (at && at.status === 'in_progress') {
        const c = examClock.clock(plan, at, now);
        row.part = c.current;
        row.phase = c.phase;
        row.secondsLeft = c.examDeadline ? Math.round((new Date(c.phase === 'section' ? c.sectionDeadline : c.examDeadline).getTime() - now) / 1000) : null;
        row.timeOver = examClock.expired(plan, at, now);
      }
      if (at && at.status === 'submitted') row.submittedAt = at.submittedAt;
      return row;
    })
    .sort((x, y) => x.name.localeCompare(y.name));
  res.json({
    exam: { id: exam.id, title: exam.title, status: exam.status, waitingRoom: waitingRoom(exam), live: isLive(exam), liveAt: (exam.config || {}).liveAt || null },
    timing: examClock.publicPlan(plan),
    people,
    serverTime: new Date(now).toISOString(),
  });
});

// Submit an in-progress attempt for the participant (e.g. they left, or time is over).
router.post('/exams/:id/attempts/:username/submit', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const attempt = await store.getAttempt(exam.id, excel.normalizeUsername(req.params.username));
  if (!attempt || attempt.status !== 'in_progress') throw httpError(409, 'No exam in progress for this participant');
  await finishAttempt(req, exam, attempt, { reason: 'admin' });
  res.json({ ok: true });
});

router.get('/roles/default', (req, res) => res.json({ roles: DEFAULT_ROLES }));

router.delete('/exams/:id', async (req, res) => {
  const exam = await loadExam(req.params.id);
  await store.deleteExam(exam);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- find & replace text

/** Every editable text field of an exam and its questions, as [label, get, set]. */
function textFields(exam, sections) {
  const fields = [];
  const f = (label, obj, key) => fields.push({ label, get: () => String(obj[key] ?? ''), set: (v) => { obj[key] = v; } });
  for (const k of ['title', 'team', 'site', 'instructions', 'instructionsHi']) f(`Exam ${k}`, exam, k);
  sections.forEach((sec, si) => {
    for (const k of ['name', 'nameHi', 'description', 'descriptionHi']) f(`Section ${si + 1} ${k}`, sec, k);
    sec.questions.forEach((q) => {
      const id = q.qid || `S${si + 1}`;
      for (const k of ['textEn', 'textHi', 'scenarioEn', 'scenarioHi', 'category', 'explanation', 'explanationHi']) f(`${id} ${k}`, q, k);
      q.options.forEach((o, oi) => {
        f(`${id} option ${excel.OPTIONS[oi]} (EN)`, o, 'en');
        f(`${id} option ${excel.OPTIONS[oi]} (HI)`, o, 'hi');
      });
      for (const l of excel.OPTIONS) if ((q.revealMap || {})[l]) f(`${id} reveals ${l}`, q.revealMap, l);
    });
  });
  return fields;
}

/**
 * Replace a word or phrase everywhere in an exam (e.g. LBIA -> LIAL).
 * { find, replace, apply } — without apply it only previews the matches.
 */
router.post('/exams/:id/replace', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const find = String(req.body.find || '');
  const replace = String(req.body.replace ?? '');
  if (find.trim().length < 2) throw httpError(400, 'Enter at least 2 characters to find');
  const sections = await bankForEditor(exam);
  const matches = [];
  for (const fld of textFields(exam, sections)) {
    const text = fld.get();
    const count = text.split(find).length - 1;
    if (count) matches.push({ field: fld.label, count, before: text, after: text.split(find).join(replace), fld });
  }
  const total = matches.reduce((n, m) => n + m.count, 0);
  if (req.body.apply && total) {
    for (const m of matches) m.fld.set(m.after);
    await store.saveExam(exam);
    await store.saveQuestionBank(exam, normalizeSections(sections));
    await audit.log(req, 'ADMIN_EDIT_TEXT', { admin_username: 'admin', exam_id: exam.id, find, replace, replacements: total, fields: matches.length });
  }
  res.json({
    applied: !!req.body.apply && total > 0,
    total,
    fields: matches.map((m) => ({ field: m.field, count: m.count, before: m.before.slice(0, 300), after: m.after.slice(0, 300) })),
  });
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
        designation: (users.get(a.username) || {}).designation || '',
        shift: (users.get(a.username) || {}).shift || '',
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
  const bank = await store.getQuestionBank(exam);
  await store.deleteAttempt(exam.id, username);
  await store.removeSubmission(exam, username, (s2, r2) => scoring.buildAnalyticsSheet(s2, r2, bank, exam));
  await audit.log(req, 'ADMIN_RESET_ATTEMPT', { admin_username: 'admin', exam_id: exam.id, participant_username: username });
  res.json({ ok: true });
});

router.get('/exams/:id/results/:username', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const username = excel.normalizeUsername(req.params.username);
  const attempt = await store.getAttempt(exam.id, username);
  if (!attempt || !attempt.result) throw httpError(404, 'No submission');
  const [rawResponses, bank, summary] = await Promise.all([
    store.getResponseRows(exam, username),
    store.getQuestionBank(exam),
    store.getSummaryRows(exam),
  ]);
  const responses = leadership.withBestAnswers(rawResponses, bank);
  await audit.log(req, 'ADMIN_VIEW_RESULT', { admin_username: 'admin', exam_id: exam.id, viewed_participant_username: username });
  res.json({
    result: resultCard(exam, attempt, { admin: true }),
    attempt: attemptInfo(exam, attempt),
    responses,
    posture: scoring.behaviourPosture(responses, exam),
    leadership: leadership.individual({ result: attempt.result, rows: responses, summary, bank, exam }),
  });
});

router.get('/exams/:id/analytics', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const [summary, responses, bank] = await Promise.all([
    store.getSummaryRows(exam),
    store.getResponseRows(exam),
    store.getQuestionBank(exam),
  ]);
  const [assignments, reports] = await Promise.all([
    store.getAssignments(),
    store.getAudit({ examId: exam.id, event: 'QUESTION_REPORTED' }),
  ]);
  const assignedAll = assignments.filter((a) => a.examId === exam.id).length;

  // Filters: role they can do, designation, shift, verdict, name.
  const f = req.query || {};
  const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((x, y) => x.localeCompare(y));
  const filterOptions = {
    roles: uniq(summary.flatMap(leadership.rolesOf)),
    designations: uniq(summary.map((r) => String(r.Designation || ''))),
    shifts: uniq(summary.map((r) => String(r.Shift || ''))),
    verdicts: leadership.HEADLINES,
  };
  let rows = summary;
  if (f.role) rows = rows.filter((r) => leadership.rolesOf(r).includes(String(f.role)));
  if (f.designation) rows = rows.filter((r) => String(r.Designation || '') === String(f.designation));
  if (f.shift) rows = rows.filter((r) => String(r.Shift || '') === String(f.shift));
  if (f.q) {
    const q = String(f.q).toLowerCase();
    rows = rows.filter((r) => `${r.Name} ${r.Username}`.toLowerCase().includes(q));
  }
  if (f.verdict) {
    const all = leadership.team({ analytics: scoring.computeAnalytics(summary, responses, bank, exam), summary, responses, bank, exam, assigned: assignedAll, reports }) || { people: [] };
    const keep = new Set(all.people.filter((p) => p.headline === String(f.verdict)).map((p) => p.username));
    rows = rows.filter((r) => keep.has(r.Username));
  }
  const filtered = rows.length !== summary.length || ['role', 'designation', 'shift', 'q', 'verdict'].some((k) => f[k]);
  const users = new Set(rows.map((r) => r.Username));
  const resp = filtered ? responses.filter((r) => users.has(r.Username)) : responses;
  const analytics = scoring.computeAnalytics(rows, resp, bank, exam);
  const assigned = filtered ? rows.length : assignedAll;
  res.json({
    analytics,
    team: leadership.team({ analytics, summary: rows, responses: resp, bank, exam, assigned, reports: filtered ? [] : reports }),
    filterOptions,
    filtered,
  });
});

router.get('/exams/:id/download', async (req, res) => {
  const exam = await loadExam(req.params.id);
  // Build the workbook fresh (current remarks + Analytics) from the active store.
  const [rawSummary, responses, bank] = await Promise.all([
    store.getSummaryRows(exam),
    store.getResponseRows(exam),
    store.getQuestionBank(exam),
  ]);
  const summary = scoring.refreshRemarks(rawSummary, exam);
  await audit.log(req, 'ADMIN_DOWNLOAD_EXCEL', { admin_username: 'admin', exam_id: exam.id, file_generated: exam.fileName });
  const entries = (await store.getAudit({ examId: exam.id })).sort((a, b) => a.seq - b.seq);
  // Leadership summary (one row per person) and question reports.
  const attempts = new Map((await store.getAttempts(exam.id)).map((a) => [a.username, a]));
  const leaderRows = summary
    .map((s) => {
      const at = attempts.get(s.Username);
      if (!at || !at.result) return null;
      const L = leadership.individual({ result: at.result, rows: responses.filter((r) => r.Username === s.Username), summary, bank, exam });
      const row = { Name: s.Name, Username: s.Username, 'Score %': s['Total Score %'], Headline: L.headline, 'How seriously': L.engagement.level, Summary: L.paragraph };
      for (const x of L.answers) row[x.q] = x.a;
      return row;
    })
    .filter(Boolean);
  const reportRows = entries
    .filter((e) => e.event === 'QUESTION_REPORTED')
    .map((e) => {
      const d = JSON.parse(e.data || '{}');
      return { 'Reported At (UTC)': e.ts, Username: e.username, Question: d.question_id, Reason: d.reason, Comment: d.comment, Language: d.language };
    });
  const build = (auditRows) =>
    excel.buildResultsWorkbook({
      summary,
      responses: leadership.withBestAnswers(responses, bank),
      bank,
      analyticsAoa: scoring.buildAnalyticsSheet(summary, responses, bank, exam),
      auditRows,
      extraSheets: [
        { name: 'Leadership Summary', rows: leaderRows },
        { name: 'Question Reports', rows: reportRows },
      ],
    });
  // Serverless responses are limited to ~6 MB. Results always come first: if
  // the file would be too large, the Audit_Log sheet keeps only key events
  // (logins, starts, changes, tab switches, submits, admin actions) and
  // the complete log stays downloadable from the Audit log page.
  let buf = build(audit.toRows(entries));
  if (buf.length > MAX_DOWNLOAD_BYTES) {
    const key = entries.filter((e) => !CLICK_EVENTS.includes(e.event));
    const note = { Seq: '', Event: 'NOTE', Details: `Per-click events (${CLICK_EVENTS.join(', ')}) omitted to keep this file downloadable. Download the full log from Admin → Audit log.` };
    buf = build([note, ...audit.toRows(key)]);
    if (buf.length > MAX_DOWNLOAD_BYTES) buf = build([{ ...note, Details: 'Audit log omitted from this file because of its size. Download it from Admin → Audit log.' }]);
  }
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${exam.fileName.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(exam.fileName)}`,
  );
  res.send(buf);
});

router.get('/exams/:id/reports', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const [entries, users] = await Promise.all([store.getAudit({ examId: exam.id, event: 'QUESTION_REPORTED' }), store.getUsers()]);
  const names = new Map(users.map((u) => [u.username, u.name]));
  const reports = entries.map((e) => {
    const d = JSON.parse(e.data || '{}');
    return {
      seq: Number(e.seq),
      at: e.ts,
      username: e.username,
      name: names.get(e.username) || e.username,
      qid: d.question_id,
      questionNumber: d.question_number,
      reason: d.reason,
      comment: d.comment,
      language: d.language,
    };
  });
  res.json({ reports });
});

// ---------------------------------------------------------------- users

router.get('/users', async (req, res) => {
  const [assignments, userList] = await Promise.all([store.getAssignments(), store.getUsers()]);
  const users = userList.map((u) => ({
    username: u.username,
    name: u.name,
    nameHi: u.nameHi,
    designation: u.designation,
    post: u.post,
    shift: u.shift,
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
  await audit.log(req, 'ADMIN_ADD_PARTICIPANT', { admin_username: 'admin', participant_username: username, exam_id: examId || null });
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
  for (const u of hashed) {
    await audit.log(req, 'ADMIN_ADD_PARTICIPANT', { admin_username: 'admin', participant_username: u.username, exam_id: examId || null });
  }
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
  await audit.log(req, 'ADMIN_ADD_PARTICIPANT', { admin_username: 'admin', participant_username: user.username, exam_id: exam.id });
  res.json({ ok: true });
});

router.delete('/users/:username', async (req, res) => {
  await store.deleteUser(req.params.username);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- import question database

const SECTION_NAMES = {
  knowledge: { name: 'Knowledge', nameHi: 'ज्ञान' },
  behaviour: { name: 'Behaviour', nameHi: 'व्यवहार' },
  behavior: { name: 'Behaviour', nameHi: 'व्यवहार' },
  values: { name: 'Values & Priorities', nameHi: 'मूल्य और प्राथमिकताएँ' },
};

/** Section name/description: from the file's optional "sections_meta", else defaults. */
function sectionMeta(db, key) {
  const m = ((db && db.sections_meta) || {})[key] || {};
  const d = SECTION_NAMES[key.toLowerCase()] || { name: key, nameHi: '' };
  return {
    name: m.name || d.name,
    nameHi: m.name_hi || d.nameHi,
    description: m.description || '',
    descriptionHi: m.description_hi || '',
  };
}

/** One question from the PassSection database JSON -> editor/question shape. */
function importQuestion(q, where) {
  if (!q || typeof q !== 'object') throw httpError(400, `${where}: not an object`);
  const en = q.en || {};
  const hi = q.hi || {};
  const byLetter = (list) => Object.fromEntries((list || []).map((o) => [String(o.letter || '').toUpperCase(), o]));
  const enOpts = byLetter(en.options);
  const hiOpts = byLetter(hi.options);
  const key = q.answer_key || {};
  const correct = String(key.correct_letter || '').toUpperCase();
  const fullCredit = (en.options || []).filter((o) => o.is_correct).map((o) => String(o.letter).toUpperCase());
  const preferred = excel.letters(key.preferred_options);
  return {
    qid: q.id,
    type: q.type || String(q.section || '').toUpperCase(),
    category: q.category,
    difficulty: q.difficulty,
    textEn: en.question,
    textHi: hi.question,
    scenarioEn: en.scenario,
    scenarioHi: hi.scenario,
    options: excel.OPTIONS.map((l) => ({ en: (enOpts[l] || {}).text || '', hi: (hiOpts[l] || {}).text || '' })),
    correct,
    fullCredit,
    // Preferred-but-not-best answers earn partial credit.
    partial: preferred.filter((l) => l !== correct && !fullCredit.includes(l)),
    concern: key.concern_options,
    neutral: key.neutral_options,
    explanation: key.explanation_en,
    explanationHi: key.explanation_hi,
    revealMap: q.reveal_map,
    dimension: (q.scoring || {}).dimension,
    weight: (q.scoring || {}).weight,
    tags: q.analytics_tags,
  };
}

router.post('/import', async (req, res) => {
  const db = req.body && req.body.database;
  const metaIn = (req.body && req.body.meta) || {};
  const resetPasswords = !!(req.body && req.body.resetPasswords);
  if (!db || typeof db !== 'object' || !db.questions || typeof db.questions !== 'object') {
    throw httpError(400, 'This does not look like the PassSection database JSON (no "questions" object).');
  }
  const warnings = [];

  // Sections: every array under "questions" (knowledge, behaviour, ...) in file order.
  const rawSections = Object.entries(db.questions).filter(([, v]) => Array.isArray(v) && v.length);
  if (!rawSections.length) throw httpError(400, 'No questions found in the file.');
  const sections = normalizeSections(
    rawSections.map(([key, list]) => ({
      ...sectionMeta(db, key),
      questions: list.map((q, i) => importQuestion(q, `${key} #${i + 1}`)),
    })),
  );
  const declared = [db.questions.total_knowledge, db.questions.total_behaviour].filter((n) => typeof n === 'number');
  const found = rawSections.reduce((n, [, v]) => n + v.length, 0);
  if (declared.length && declared.reduce((a, b) => a + b, 0) !== found) {
    warnings.push(`The file declares ${declared.reduce((a, b) => a + b, 0)} questions but contains ${found}.`);
  }

  // Scoring config from the file.
  const sys = db.system_config || {};
  const timers = sys.timer_per_question_seconds || {};
  const dimensions = {};
  for (const group of Object.values(db.scoring_dimensions || {})) {
    for (const [k, d] of Object.entries(group || {})) dimensions[k] = { label: d.label, labelHi: d.label_hi };
  }
  const remarkRules = ((db.remarks_config || {}).thresholds || []).map((t) => ({
    condition: t.condition,
    en: t.remark_en,
    hi: t.remark_hi,
  }));
  const timerSeconds = { KNOWLEDGE: timers.knowledge, BEHAVIOUR: timers.behaviour ?? timers.behavior };
  const estimated = sections.reduce(
    (sum, sec) => sum + sec.questions.reduce((t, q) => t + (num(timerSeconds[q.type], 60) || 60), 0),
    0,
  );

  const meta = normalizeMeta({
    title: metaIn.title || 'Pass Section Knowledge & Behaviour Assessment 2026',
    team: metaIn.team ?? 'Pass Section — LIAL',
    site: metaIn.site ?? 'Lucknow International Airport',
    examDate: metaIn.examDate || new Date().toISOString().slice(0, 10),
    instructions: metaIn.instructions || '',
    instructionsHi: metaIn.instructionsHi || '',
    unlockDays: metaIn.unlockDays ?? sys.result_unlock_days ?? config.defaultUnlockDays,
    estimatedMinutes: metaIn.estimatedMinutes || Math.ceil(estimated / 60),
    status: metaIn.status || 'Active',
    thresholds: config.defaultThresholds,
    config: { partialCreditPct: metaIn.partialCreditPct ?? 50, timerSeconds, remarkRules, dimensions },
  });

  // Staff roster (participants only — the admin login always comes from ADMIN_PASSWORD).
  const roster = Array.isArray(db.staff_roster) ? db.staff_roster : [];
  const known = new Map((await store.getUsers()).map((u) => [u.username, u]));
  const users = [];
  let adminInRoster = false;
  for (const [i, p] of roster.entries()) {
    const username = excel.normalizeUsername(p.username);
    if (p.role === 'admin' || username === config.adminUsername) {
      adminInRoster = true;
      continue;
    }
    if (!USERNAME_RE.test(username)) {
      warnings.push(`Staff #${i + 1} (${p.name || '?'}): invalid username "${p.username}" — skipped.`);
      continue;
    }
    const password = String(p.initial_password || '');
    const isNew = !known.has(username);
    if (isNew && password.length < 4) {
      warnings.push(`Staff ${username}: missing initial_password — skipped.`);
      continue;
    }
    users.push({
      username,
      name: clean(p.name, 200),
      nameHi: clean(p.name_hi, 200),
      designation: clean(p.designation, 200),
      post: clean(p.post, 100),
      shift: clean(p.shift, 100),
      staffId: clean(p.id, 40),
      passwordHash: isNew || resetPasswords ? await hashPassword(password) : '',
      isNew,
    });
  }

  // Either add the file's sections to an existing exam, or create a new exam.
  const targetId = clean(req.body.targetExamId, 40);
  let exam;
  let finalSections = sections;
  if (targetId) {
    exam = await loadExam(targetId);
    const stats = await examStats(exam);
    if (stats.submitted > 0 || stats.inProgress > 0) {
      throw httpError(409, 'People have already started this exam, so questions cannot be added. Import into a new exam instead.');
    }
    const existing = await bankForEditor(exam);
    const existingIds = new Set(existing.flatMap((sec) => sec.questions.map((q) => q.qid)).filter(Boolean));
    const dupes = sections.flatMap((sec) => sec.questions.map((q) => q.qid)).filter((id) => id && existingIds.has(id));
    if (dupes.length) throw httpError(409, `These question IDs are already in the exam: ${dupes.slice(0, 8).join(', ')}. Nothing was added.`);
    finalSections = normalizeSections([...existing, ...sections]);
    const cfg = exam.config || {};
    exam.config = normalizeConfig({
      ...cfg,
      dimensions: { ...dimensions, ...(cfg.dimensions || {}) },
      timerSeconds: { ...timerSeconds, ...(cfg.timerSeconds || {}) },
      remarkRules: cfg.remarkRules && cfg.remarkRules.length ? cfg.remarkRules : remarkRules,
    });
    if (exam.estimatedMinutes) exam.estimatedMinutes += Math.ceil(estimated / 60);
    await store.saveExam(exam);
    await store.saveQuestionBank(exam, finalSections);
  } else {
    exam = { id: `EX${Date.now().toString(36).toUpperCase()}`, ...meta, fileName: '', createdAt: new Date().toISOString() };
    await store.saveExam(exam);
    await store.saveQuestionBank(exam, sections);
  }
  if (users.length) await store.upsertUsers(users);
  const assigned = users.length ? await store.assign(exam.id, users.map((u) => u.username)) : 0;

  if (!targetId) {
    await audit.log(req, 'ADMIN_CREATE_EXAM', { admin_username: 'admin', exam_id: exam.id, exam_title: exam.title, team: exam.team, site: exam.site });
  }
  await audit.log(req, 'ADMIN_IMPORT_DATABASE', {
    admin_username: 'admin',
    exam_id: exam.id,
    source_ref: db.ref || null,
    source_version: db.version || null,
    questions: found,
    staff_created: users.filter((u) => u.isNew).length,
    staff_updated: users.filter((u) => !u.isNew).length,
    passwords_reset: resetPasswords,
    mode: targetId ? 'added_to_existing_exam' : 'new_exam',
  });
  for (const u of users) {
    await audit.log(req, 'ADMIN_ADD_PARTICIPANT', { admin_username: 'admin', participant_username: u.username, exam_id: exam.id });
  }

  res.status(201).json({
    exam,
    appended: !!targetId,
    totalQuestions: finalSections.reduce((n, sec) => n + sec.questions.length, 0),
    questions: found,
    sections: sections.map((sec) => ({ name: sec.name, questions: sec.questions.length })),
    created: users.filter((u) => u.isNew).length,
    updated: users.filter((u) => !u.isNew).length,
    assigned,
    adminInRoster,
    warnings,
  });
});

// ---------------------------------------------------------------- update wording from a file

const TEXT_FIELDS = ['textEn', 'textHi', 'scenarioEn', 'scenarioHi', 'category', 'explanation', 'explanationHi'];

/**
 * Update only the wording of existing questions from a database JSON,
 * matched by question ID (K01, B05…). Answer keys, scoring, weights and the
 * order of options are never changed, so it is safe even after people have
 * submitted. Pass apply=false to preview.
 */
router.post('/exams/:id/update-text', async (req, res) => {
  const exam = await loadExam(req.params.id);
  const db = req.body && req.body.database;
  if (!db || typeof db !== 'object' || !db.questions) throw httpError(400, 'This does not look like the PassSection database JSON.');
  const incoming = new Map();
  for (const [key, list] of Object.entries(db.questions)) {
    if (!Array.isArray(list)) continue;
    list.forEach((q, i) => {
      if (q && q.id) incoming.set(String(q.id), importQuestion(q, `${key} #${i + 1}`));
    });
  }
  const sections = await bankForEditor(exam);
  const changes = [];
  const matched = new Set();
  for (const sec of sections) {
    for (const q of sec.questions) {
      const src = incoming.get(q.qid);
      if (!src) continue;
      matched.add(q.qid);
      const changed = [];
      for (const f of TEXT_FIELDS) {
        const v = clean(src[f]);
        if (v && v !== (q[f] || '')) {
          changed.push(f);
          q[f] = v;
        }
      }
      src.options.forEach((o, i) => {
        for (const lang of ['en', 'hi']) {
          const v = clean(o[lang], 2000);
          if (v && q.options[i] && v !== q.options[i][lang]) {
            changed.push(`option ${excel.OPTIONS[i]} (${lang.toUpperCase()})`);
            q.options[i][lang] = v;
          }
        }
      });
      const reveal = src.revealMap || {};
      for (const l of excel.OPTIONS) {
        const v = clean(reveal[l], 1000);
        if (v && v !== (q.revealMap || {})[l]) {
          changed.push(`reveals ${l}`);
          q.revealMap = { ...(q.revealMap || {}), [l]: v };
        }
      }
      // Tags only group questions for analytics; they never change scores.
      const tags = (src.tags || []).map((t) => clean(t, 60)).filter(Boolean).slice(0, 20);
      if (tags.length && JSON.stringify(tags) !== JSON.stringify(q.tags || [])) {
        changed.push('tags');
        q.tags = tags;
      }
      if (changed.length) changes.push({ qid: q.qid, fields: changed });
    }
  }
  const notInExam = [...incoming.keys()].filter((id) => !matched.has(id));
  if (req.body.apply && changes.length) {
    await store.saveQuestionBank(exam, normalizeSections(sections));
    await audit.log(req, 'ADMIN_EDIT_TEXT', {
      admin_username: 'admin',
      exam_id: exam.id,
      mode: 'update_from_file',
      questions_changed: changes.length,
      fields_changed: changes.reduce((n, c) => n + c.fields.length, 0),
    });
  }
  res.json({ applied: !!req.body.apply && changes.length > 0, changes, notInExam });
});

// ---------------------------------------------------------------- audit trail (admin only)

router.get('/audit', async (req, res) => {
  const limit = Math.min(500, Math.max(1, Math.floor(num(req.query.limit, 100))));
  const entries = await store.getAudit({
    examId: clean(req.query.examId, 40) || undefined,
    username: excel.normalizeUsername(req.query.username) || undefined,
    event: clean(req.query.event, 60) || undefined,
    beforeSeq: num(req.query.beforeSeq, 0) || undefined,
    limit,
  });
  res.json({ entries: audit.toRows(entries), events: audit.EVENTS, hasMore: entries.length === limit });
});

router.get('/audit/verify', async (req, res) => {
  res.json(await audit.verify());
});

router.get('/audit/download', async (req, res) => {
  const examId = clean(req.query.examId, 40) || undefined;
  const [entries, check] = await Promise.all([store.getAudit({ examId }), audit.verify()]);
  const sorted = entries.sort((a, b) => a.seq - b.seq);
  // ?detail=key leaves out per-click events; used automatically if the full file is too large.
  const onlyKey = req.query.detail === 'key';
  const makeRows = (keyOnly) => audit.toRows(keyOnly ? sorted.filter((e) => !CLICK_EVENTS.includes(e.event)) : sorted);
  let rows = makeRows(onlyKey);
  let buf;
  const verificationRows = (note) => [
    {
      'Checked At (UTC)': new Date().toISOString(),
      'Chain Intact': check.ok ? 'YES' : 'NO',
      'Entries Checked': check.count,
      'First Problem': check.ok ? '' : `#${check.brokenAt}: ${check.reason}`,
      'Last Hash': check.lastHash || '',
      Note: note || '',
    },
  ];
  buf = excel.buildSheetsWorkbook([{ name: 'Audit_Log', rows }, { name: 'Verification', rows: verificationRows(onlyKey ? 'Per-click events omitted (detail=key).' : '') }]);
  if (buf.length > MAX_DOWNLOAD_BYTES && !onlyKey) {
    rows = makeRows(true);
    buf = excel.buildSheetsWorkbook([
      { name: 'Audit_Log', rows },
      { name: 'Verification', rows: verificationRows(`Per-click events (${CLICK_EVENTS.join(', ')}) omitted because the full log is too large for one download. Filter by exam to download them.`) },
    ]);
  }
  const name = `Audit_Log${examId ? `_${examId}` : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buf);
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
