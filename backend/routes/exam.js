const express = require('express');
const store = require('../services/store');
const { OPTIONS } = require('../services/excelService');
const timer = require('../services/timerService');
const scoring = require('../services/scoringService');
const audit = require('../services/auditService');
const cache = require('../services/cache');

// Exam content rarely changes during an exam; admin edits reach every
// instance within this time.
const TTL = 15 * 1000;
const cachedExam = (id) => cache.get(`exam:${id}`, TTL, () => store.getExam(id));
const cachedAssigned = (id, username) => cache.get(`assigned:${id}:${username}`, TTL, () => store.isAssigned(id, username));
const cachedBank = (exam) => cache.get(`bank:${exam.id}`, TTL, () => store.getQuestionBank(exam));

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
    // Suggested seconds per question by type, e.g. { KNOWLEDGE: 30, BEHAVIOUR: 45 } (a guide, not a hard limit).
    timerSeconds: (exam.config && exam.config.timerSeconds) || {},
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
    scenarioEn: q.scenarioEn || '',
    scenarioHi: q.scenarioHi || '',
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
  const [bank, attempt] = await Promise.all([cachedBank(exam), store.getAttempt(exam.id, username)]);
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
    cachedExam(req.params.id),
    cachedAssigned(req.params.id, req.session.user.username),
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
    // Read the status fresh so opening the exam takes effect immediately.
    const fresh = await store.getExam(exam.id);
    if (!fresh || fresh.status !== 'Active') return res.status(409).json({ error: 'This exam is not open.' });
    const bank = await cachedBank(exam);
    if (!bank.questions.length) return res.status(409).json({ error: 'This exam has no questions yet.' });
    const state = timer.recordView({}, 1);
    await store.saveAttempt(exam.id, {
      username,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      state,
    });
    await audit.log(req, 'EXAM_START', { username, exam_id: exam.id, exam_title: exam.title });
    await audit.log(req, 'QUESTION_VIEW', {
      username,
      exam_id: exam.id,
      question_id: bank.questions[0].qid,
      question_number: 1,
      section: bank.questions[0].sectionNo,
      time_on_previous_question_seconds: null,
    });
  }
  req.session.activeExam = exam.id;
  res.json(await examView(exam, username));
});

const secs = (ms) => Math.round(Math.max(0, ms) / 1000);
const VIA = ['button', 'palette', 'review', 'resume'];

router.post('/:id/event', async (req, res) => {
  const exam = await loadAssignedExam(req, res);
  if (!exam) return;
  const { username } = req.session.user;
  const attempt = await store.getAttempt(exam.id, username);
  if (!attempt || attempt.status !== 'in_progress') return res.status(409).json({ error: 'Exam not in progress' });
  const bank = await cachedBank(exam);
  const { type, q, option, flagged } = req.body || {};
  // Review / submit events are not tied to a question; everything else is.
  const needsQuestion = !['review', 'submit_attempt'].includes(type);
  const no = needsQuestion ? Number(q) : Number(attempt.state.current) || 1;
  if (!Number.isInteger(no) || no < 1 || no > bank.questions.length) return res.status(400).json({ error: 'Invalid question' });
  const question = bank.questions[no - 1];
  const state = attempt.state;
  const now = Date.now();
  const base = { username, exam_id: exam.id, question_id: question.qid };
  const events = [];
  let changed = true;

  if (type === 'view') {
    const from = state.current;
    const prevShownAt = state.lastViewAt;
    timer.recordView(state, no, now);
    if (from !== no) {
      const via = VIA.includes(req.body.via) ? req.body.via : 'button';
      events.push(['NAVIGATION', { username, exam_id: exam.id, from_question: from || null, to_question: no, via_palette_or_button: via }]);
      events.push([
        'QUESTION_VIEW',
        {
          ...base,
          question_number: no,
          section: question.sectionNo,
          time_on_previous_question_seconds: prevShownAt ? secs(now - prevShownAt) : null,
        },
      ]);
    } else changed = false;
  } else if (type === 'answer') {
    const opt = String(option || '').toUpperCase();
    if (opt && !OPTIONS.includes(opt)) return res.status(400).json({ error: 'Invalid option' });
    const before = (state.q && state.q[no]) || {};
    const previous = before.answer || '';
    timer.recordAnswer(state, no, opt, now);
    const after = state.q[no];
    if (previous === opt) changed = false;
    else {
      events.push([
        'ANSWER_SELECT',
        {
          ...base,
          option_selected: opt || null,
          previous_option: previous || null,
          time_since_question_displayed_seconds: state.lastViewAt ? secs(now - state.lastViewAt) : null,
          change_count: after.changes,
        },
      ]);
      if (previous) {
        events.push(['ANSWER_CHANGE', { ...base, old_option: previous, new_option: opt || null, time_of_change: new Date(now).toISOString() }]);
      }
    }
  } else if (type === 'flag') {
    timer.recordFlag(state, no, !!flagged, now);
    events.push(['QUESTION_FLAG', { ...base, flagged_true_or_false: !!flagged }]);
  } else if (type === 'lang') {
    const langs = ['en', 'hi'];
    state.langToggles = (state.langToggles || 0) + 1;
    events.push([
      'LANGUAGE_TOGGLE',
      { ...base, from_language: langs.includes(req.body.from) ? req.body.from : null, to_language: langs.includes(req.body.to) ? req.body.to : null },
    ]);
  } else if (type === 'tab_hidden') {
    if (!state.hiddenAt) {
      state.hiddenAt = now;
      state.tabHidden = (state.tabHidden || 0) + 1;
      // Duration is not known yet; it is recorded on BROWSER_TAB_VISIBLE.
      events.push(['BROWSER_TAB_HIDDEN', { ...base, duration_seconds: null }]);
    } else changed = false;
  } else if (type === 'tab_visible') {
    if (state.hiddenAt) {
      const hiddenMs = Math.min(24 * 3600 * 1000, now - state.hiddenAt);
      state.hiddenMs = (state.hiddenMs || 0) + hiddenMs;
      state.hiddenAt = null;
      events.push(['BROWSER_TAB_VISIBLE', { ...base, was_hidden_for_seconds: secs(hiddenMs) }]);
    } else changed = false;
  } else if (type === 'review') {
    changed = false;
    const qs = Object.values(state.q || {});
    events.push([
      'REVIEW_SCREEN_VIEW',
      {
        username,
        exam_id: exam.id,
        unanswered_count: bank.questions.length - qs.filter((x) => x.answer).length,
        flagged_count: qs.filter((x) => x.flagged).length,
        time_reached_review: secs(now - new Date(attempt.startedAt).getTime()),
      },
    ]);
  } else if (type === 'submit_attempt') {
    changed = false;
    events.push(['SUBMIT_ATTEMPT', { username, exam_id: exam.id, confirmation_shown: true }]);
  } else return res.status(400).json({ error: 'Invalid event' });

  if (changed) await store.saveAttempt(exam.id, attempt);
  for (const [event, fields] of events) await audit.log(req, event, fields);
  req.session.activeExam = exam.id;
  res.json({ ok: true, savedAt: new Date().toISOString() });
});

router.post('/:id/submit', async (req, res) => {
  const exam = await loadAssignedExam(req, res);
  if (!exam) return;
  const { username } = req.session.user;
  const attempt = await store.getAttempt(exam.id, username);
  if (!attempt) return res.status(409).json({ error: 'Exam not started' });
  if (attempt.status === 'submitted') return res.json({ attempt: attemptInfo(exam, attempt) });

  const [bank, user] = await Promise.all([cachedBank(exam), store.getUser(username)]);
  attempt.submittedAt = new Date().toISOString();
  const end = new Date(attempt.submittedAt).getTime();

  // Safety net: the browser sends every answer it shows on screen. Any answer
  // or flag whose autosave never reached the server (network drop, timeout)
  // is recovered here, so nothing the participant chose is lost.
  const reconciled = [];
  const sent = req.body && typeof req.body.answers === 'object' && req.body.answers ? req.body.answers : null;
  if (sent) {
    const flags = (req.body.flags && typeof req.body.flags === 'object' && req.body.flags) || {};
    for (const qq of bank.questions) {
      const clientAnswer = String(sent[qq.no] || '').toUpperCase();
      if (clientAnswer && !OPTIONS.includes(clientAnswer)) continue;
      const serverAnswer = ((attempt.state.q || {})[qq.no] || {}).answer || '';
      if (clientAnswer !== serverAnswer) {
        timer.recordAnswer(attempt.state, qq.no, clientAnswer, end);
        reconciled.push({ question_id: qq.qid, server_had: serverAnswer || null, browser_had: clientAnswer || null });
      }
      const serverFlag = !!((attempt.state.q || {})[qq.no] || {}).flagged;
      if (!!flags[qq.no] !== serverFlag) timer.recordFlag(attempt.state, qq.no, !!flags[qq.no], end);
    }
  }
  // A tab that is still hidden at submit time counts until now.
  if (attempt.state.hiddenAt) {
    attempt.state.hiddenMs = (attempt.state.hiddenMs || 0) + Math.max(0, end - attempt.state.hiddenAt);
    attempt.state.hiddenAt = null;
  }
  timer.finalize(attempt.state, end);
  attempt.status = 'submitted';

  const { result, summaryRow, responseRows } = scoring.scoreAttempt({ exam, bank, user, attempt });
  await store.saveSubmission(exam, summaryRow, responseRows, (s, r) => scoring.buildAnalyticsSheet(s, r, bank, exam));
  attempt.result = result;
  await store.saveAttempt(exam.id, attempt);
  for (const r of reconciled) {
    await audit.log(req, 'ANSWER_SELECT', { username, exam_id: exam.id, ...r, recovered_at_submit: true });
  }
  await audit.log(req, 'SUBMIT_CONFIRM', {
    username,
    exam_id: exam.id,
    total_time_seconds: result.totalSeconds,
    answers_submitted: result.answered,
    unanswered_count: result.questionCount - result.answered,
    answers_recovered_at_submit: reconciled.length,
  });
  req.session.activeExam = null;
  res.json({ attempt: attemptInfo(exam, attempt), name: user.name, nameHi: user.nameHi || '' });
});

module.exports = router;
module.exports.publicExam = publicExam;
module.exports.isUnlocked = isUnlocked;
module.exports.attemptInfo = attemptInfo;
