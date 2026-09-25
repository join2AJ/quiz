const express = require('express');
const store = require('../services/store');
const { OPTIONS } = require('../services/excelService');
const timer = require('../services/timerService');
const scoring = require('../services/scoringService');

const router = express.Router();

function publicExam(exam) {
  return {
    id: exam.id,
    title: exam.title,
    team: exam.team,
    site: exam.site,
    examDate: exam.examDate,
    instructions: exam.instructions,
    instructionsHi: exam.instructionsHi,
    unlockDays: exam.unlockDays,
    estimatedMinutes: exam.estimatedMinutes,
    status: exam.status,
  };
}

/** Questions as the participant may see them: no correct option, no explanation. */
function sanitizeQuestions(bank) {
  return bank.questions.map((q) => ({
    no: q.no,
    sectionNo: q.sectionNo,
    type: q.type,
    category: q.category,
    textEn: q.textEn,
    textHi: q.textHi,
    options: q.options.map((o) => ({ key: o.key, en: o.en, hi: o.hi })),
  }));
}

function isUnlocked(exam, attempt) {
  if (!attempt || attempt.status !== 'submitted') return false;
  if (exam.status === 'Results Released') return true;
  const unlockAt = scoring.unlockDate(attempt.submittedAt, exam.unlockDays);
  return Date.now() >= new Date(unlockAt).getTime();
}

function attemptInfo(exam, attempt) {
  if (!attempt) return { status: 'not_started' };
  const info = { status: attempt.status, startedAt: attempt.startedAt };
  if (attempt.status === 'submitted') {
    info.submittedAt = attempt.submittedAt;
    info.unlockAt = scoring.unlockDate(attempt.submittedAt, exam.unlockDays);
    info.unlocked = isUnlocked(exam, attempt);
  }
  return info;
}

function progressOf(attempt) {
  const q = (attempt.state && attempt.state.q) || {};
  const progress = { current: attempt.state.current || 1, answers: {}, flags: {}, visited: {} };
  for (const [no, s] of Object.entries(q)) {
    if (s.answer) progress.answers[no] = s.answer;
    if (s.flagged) progress.flags[no] = true;
    if (s.firstViewAt) progress.visited[no] = true;
  }
  return progress;
}

async function examView(exam, username) {
  const [bank, attempt] = await Promise.all([store.getQuestionBank(exam), store.getAttempt(exam.id, username)]);
  const view = {
    exam: publicExam(exam),
    sections: bank.sections.map((s) => ({
      ...s,
      questionCount: bank.questions.filter((q) => q.sectionNo === s.no).length,
    })),
    totalQuestions: bank.questions.length,
    attempt: attemptInfo(exam, attempt),
    serverTime: new Date().toISOString(),
  };
  if (attempt && attempt.status === 'in_progress') {
    view.questions = sanitizeQuestions(bank);
    view.progress = progressOf(attempt);
  }
  return view;
}

/** Loads the exam and verifies the participant is assigned to it (404 otherwise). */
async function loadAssignedExam(req, res) {
  const [exam, assigned] = await Promise.all([
    store.getExam(req.params.id),
    store.isAssigned(req.params.id, req.session.user.username),
  ]);
  if (!exam || !assigned) {
    res.status(404).json({ error: 'Exam not found' });
    return null;
  }
  return exam;
}

router.get('/mine', async (req, res) => {
  const { username } = req.session.user;
  const ids = (await store.getAssignments()).filter((a) => a.username === username).map((a) => a.examId);
  const mine = (await store.getExams()).filter((e) => ids.includes(e.id));
  const attempts = await Promise.all(mine.map((e) => store.getAttempt(e.id, username)));
  const exams = mine
    .map((e, i) => ({ ...publicExam(e), attempt: attemptInfo(e, attempts[i]) }))
    .sort((a, b) => String(b.examDate).localeCompare(String(a.examDate)));
  res.json({ exams });
});

router.get('/:id', async (req, res) => {
  const exam = await loadAssignedExam(req, res);
  if (!exam) return;
  res.json(await examView(exam, req.session.user.username));
});

router.post('/:id/start', async (req, res) => {
  const exam = await loadAssignedExam(req, res);
  if (!exam) return;
  const { username } = req.session.user;
  const existing = await store.getAttempt(exam.id, username);
  if (!existing) {
    if (exam.status !== 'Active') return res.status(409).json({ error: 'This exam is not open.' });
    const bank = await store.getQuestionBank(exam);
    if (!bank.questions.length) return res.status(409).json({ error: 'This exam has no questions yet.' });
    const state = timer.recordView({}, 1);
    await store.saveAttempt(exam.id, {
      username,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      state,
    });
  }
  res.json(await examView(exam, username));
});

router.post('/:id/event', async (req, res) => {
  const exam = await loadAssignedExam(req, res);
  if (!exam) return;
  const attempt = await store.getAttempt(exam.id, req.session.user.username);
  if (!attempt || attempt.status !== 'in_progress') return res.status(409).json({ error: 'Exam not in progress' });
  const total = (await store.getQuestionBank(exam)).questions.length;
  const { type, q, option, flagged } = req.body || {};
  const no = Number(q);
  if (!Number.isInteger(no) || no < 1 || no > total) return res.status(400).json({ error: 'Invalid question' });

  if (type === 'view') timer.recordView(attempt.state, no);
  else if (type === 'answer') {
    const opt = String(option || '').toUpperCase();
    if (opt && !OPTIONS.includes(opt)) return res.status(400).json({ error: 'Invalid option' });
    timer.recordAnswer(attempt.state, no, opt);
  } else if (type === 'flag') timer.recordFlag(attempt.state, no, !!flagged);
  else return res.status(400).json({ error: 'Invalid event' });

  await store.saveAttempt(exam.id, attempt);
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

router.post('/:id/submit', async (req, res) => {
  const exam = await loadAssignedExam(req, res);
  if (!exam) return;
  const { username } = req.session.user;
  const attempt = await store.getAttempt(exam.id, username);
  if (!attempt) return res.status(409).json({ error: 'Exam not started' });
  if (attempt.status === 'submitted') return res.json({ attempt: attemptInfo(exam, attempt) });

  const [bank, user] = await Promise.all([store.getQuestionBank(exam), store.getUser(username)]);
  attempt.submittedAt = new Date().toISOString();
  timer.finalize(attempt.state, new Date(attempt.submittedAt).getTime());
  attempt.status = 'submitted';

  const { result, summaryRow, responseRows } = scoring.scoreAttempt({ exam, bank, user, attempt });
  await store.saveSubmission(exam, summaryRow, responseRows, scoring.buildAnalyticsSheet);
  attempt.result = result;
  await store.saveAttempt(exam.id, attempt);
  res.json({ attempt: attemptInfo(exam, attempt), name: user.name });
});

module.exports = router;
module.exports.publicExam = publicExam;
module.exports.isUnlocked = isUnlocked;
module.exports.attemptInfo = attemptInfo;
