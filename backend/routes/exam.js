const express = require('express');
const store = require('../services/store');
const { OPTIONS } = require('../services/excelService');
const timer = require('../services/timerService');
const scoring = require('../services/scoringService');
const audit = require('../services/auditService');
const cache = require('../services/cache');
const examClock = require('../services/examClock');
const presence = require('../services/presenceService');
const { rolesFor } = require('../services/roles');

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
    // Waiting room: participants wait until the examiner starts the exam.
    waitingRoom: waitingRoom(exam),
    live: isLive(exam),
    roles: rolesFor(exam).map((r) => ({ key: r.key, en: r.en, hi: r.hi })),
  };
}

function waitingRoom(exam) {
  return !(exam.config && exam.config.waitingRoom === false);
}

function isLive(exam) {
  return !waitingRoom(exam) || !!(exam.config && exam.config.liveAt);
}

function showSectionNames(exam) {
  return !!(exam.config && exam.config.showSectionNames);
}

/** Questions as the participant may see them: no correct option, explanation or category. */
function sanitizeQuestions(bank) {
  return bank.questions.map((q) => ({
    no: q.no,
    sectionNo: q.sectionNo,
    type: q.type, // only used for the suggested time per question
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

async function examView(exam, username, known) {
  const [bank, attempt] = await Promise.all([cachedBank(exam), known !== undefined ? known : store.getAttempt(exam.id, username)]);
  const plan = examClock.plan(exam, bank);
  const view = {
    timing: examClock.publicPlan(plan),
    exam: publicExam(exam),
    // Unless the exam is set to show them, section names/descriptions are not
    // sent to participants (they see "Part 1, Part 2…"), so labels such as
    // "Behaviour" do not steer their answers.
    sections: bank.sections.map((s) => ({
      no: s.no,
      ...(showSectionNames(exam)
        ? { name: s.name, nameHi: s.nameHi, description: s.description, descriptionHi: s.descriptionHi }
        : { name: '', nameHi: '', description: '', descriptionHi: '' }),
      questionCount: bank.questions.filter((q) => q.sectionNo === s.no).length,
    })),
    totalQuestions: bank.questions.length,
    attempt: attemptInfo(exam, attempt),
    serverTime: new Date().toISOString(),
  };
  if (attempt && attempt.status === 'in_progress') {
    view.questions = sanitizeQuestions(bank);
    view.progress = progressOf(attempt);
    view.clock = examClock.clock(plan, attempt);
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
  const { username } = req.session.user;
  let attempt = await store.getAttempt(exam.id, username);
  if (attempt && attempt.status === 'in_progress') {
    const bank = await cachedBank(exam);
    if (examClock.expired(examClock.plan(exam, bank), attempt)) {
      attempt = (await finishAttempt(req, exam, attempt, { reason: 'time_over' })).attempt;
    }
  }
  const stage = !attempt ? 'waiting' : attempt.status === 'submitted' ? 'submitted' : 'exam';
  await presence.touch(username, req.session.sid, { stage, examId: exam.id }).catch(() => {});
  res.json(await examView(exam, username, attempt));
});

// Polled by the waiting room: has the examiner started the exam?
router.get('/:id/status', async (req, res) => {
  const [exam, assigned] = await Promise.all([
    cache.get(`live:${req.params.id}`, 3000, () => store.getExam(req.params.id)),
    cachedAssigned(req.params.id, req.session.user.username),
  ]);
  if (!exam || !assigned) return res.status(404).json({ error: 'Exam not found' });
  await presence.touch(req.session.user.username, req.session.sid, { stage: 'waiting', examId: exam.id }).catch(() => {});
  res.json({ status: exam.status, live: isLive(exam), waitingRoom: waitingRoom(exam), serverTime: new Date().toISOString() });
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
    if (!isLive(fresh)) return res.status(409).json({ code: 'WAITING', error: 'Please wait — the examiner has not started the exam yet.' });
    const bank = await cachedBank(exam);
    if (!bank.questions.length) return res.status(409).json({ error: 'This exam has no questions yet.' });
    const state = timer.recordView({}, 1);
    await store.saveAttempt(exam.id, {
      username,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      state: { ...state, sec: { ends: {} } },
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
  await presence.touch(username, req.session.sid, { stage: 'exam', examId: exam.id }).catch(() => {});
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
  // Time limits: only the open part can be viewed or answered.
  const plan = examClock.plan(exam, bank);
  const clk = examClock.clock(plan, attempt, now);
  if (['view', 'answer', 'flag'].includes(type) && !examClock.canAnswer(clk, question.sectionNo, now)) {
    return res.status(409).json({ code: 'SECTION_CLOSED', error: 'This part has ended.', clock: clk });
  }
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

// A participant reports a problem with a question (unclear, wrong translation…).
// Stored in the audit log; admins see them under the exam's Reports tab.
const REPORT_REASONS = ['unclear', 'translation', 'multiple_correct', 'no_correct', 'spelling', 'other'];
router.post('/:id/report', async (req, res) => {
  const exam = await loadAssignedExam(req, res);
  if (!exam) return;
  const bank = await cachedBank(exam);
  const no = Number(req.body && req.body.q);
  const question = bank.questions[no - 1];
  if (!question) return res.status(400).json({ error: 'Invalid question' });
  const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : 'other';
  const comment = String(req.body.comment || '').trim().slice(0, 1000);
  await audit.log(req, 'QUESTION_REPORTED', {
    username: req.session.user.username,
    exam_id: exam.id,
    question_id: question.qid,
    question_number: no,
    reason,
    comment,
    language: req.body.lang === 'hi' ? 'hi' : 'en',
  });
  res.json({ ok: true });
});

// The participant finishes the open part early; the next part starts now.
router.post('/:id/section/next', async (req, res) => {
  const exam = await loadAssignedExam(req, res);
  if (!exam) return;
  const { username } = req.session.user;
  const attempt = await store.getAttempt(exam.id, username);
  if (!attempt || attempt.status !== 'in_progress') return res.status(409).json({ error: 'Exam not in progress' });
  const bank = await cachedBank(exam);
  const plan = examClock.plan(exam, bank);
  const clk = examClock.clock(plan, attempt);
  const no = Number(req.body && req.body.section);
  if (clk.timed && clk.phase === 'section' && clk.current === no) {
    attempt.state.sec = attempt.state.sec || { ends: {} };
    attempt.state.sec.ends = attempt.state.sec.ends || {};
    attempt.state.sec.ends[no] = Date.now();
    await store.saveAttempt(exam.id, attempt);
    const qs = bank.questions.filter((q) => q.sectionNo === no);
    await audit.log(req, 'SECTION_END', {
      username,
      exam_id: exam.id,
      section: no,
      ended_by: 'participant',
      seconds_used: Math.round((Date.now() - new Date(clk.sectionStartedAt).getTime()) / 1000),
      answered: qs.filter((q) => ((attempt.state.q || {})[q.no] || {}).answer).length,
      questions: qs.length,
    });
  }
  res.json(await examView(exam, username, attempt));
});

/**
 * Score and store an attempt. Used when the participant submits, when their
 * time runs out, and when an admin submits it for them.
 */
async function finishAttempt(req, exam, attempt, { answers, flags, roles, rolesOther, reason = 'participant' } = {}) {
  const username = attempt.username;
  const [bank, user] = await Promise.all([cachedBank(exam), store.getUser(username)]);
  const plan = examClock.plan(exam, bank);
  const limitEnd = new Date(attempt.startedAt).getTime() + plan.examLimitSeconds * 1000;
  // A timed exam that ran out ends at its deadline, not when it was noticed.
  const end = plan.timed && reason !== 'participant' ? Math.min(Date.now(), limitEnd) : Date.now();
  attempt.submittedAt = new Date(end).toISOString();

  // Safety net: the browser sends every answer it shows on screen. Any answer
  // or flag whose autosave never reached the server (network drop, timeout)
  // is recovered here, so nothing the participant chose is lost. With time
  // limits, recovery only fills answers the server never received.
  const reconciled = [];
  if (answers && typeof answers === 'object') {
    const flagMap = (flags && typeof flags === 'object' && flags) || {};
    for (const qq of bank.questions) {
      const clientAnswer = String(answers[qq.no] || '').toUpperCase();
      if (clientAnswer && !OPTIONS.includes(clientAnswer)) continue;
      const serverAnswer = ((attempt.state.q || {})[qq.no] || {}).answer || '';
      if (plan.timed && (serverAnswer || !clientAnswer)) continue;
      if (clientAnswer !== serverAnswer) {
        timer.recordAnswer(attempt.state, qq.no, clientAnswer, end);
        reconciled.push({ question_id: qq.qid, server_had: serverAnswer || null, browser_had: clientAnswer || null });
      }
      const serverFlag = !!((attempt.state.q || {})[qq.no] || {}).flagged;
      if (!plan.timed && !!flagMap[qq.no] !== serverFlag) timer.recordFlag(attempt.state, qq.no, !!flagMap[qq.no], end);
    }
  }
  // Work they say they can do (asked at the end).
  if (Array.isArray(roles)) {
    const allowed = new Map(rolesFor(exam).map((r) => [r.key, r]));
    const picked = [...new Set(roles.map(String))].filter((k) => allowed.has(k) || k === 'none');
    attempt.state.roles = picked;
    attempt.state.rolesOther = String(rolesOther || '').trim().slice(0, 300);
  }
  // A tab that is still hidden at submit time counts until now.
  if (attempt.state.hiddenAt) {
    attempt.state.hiddenMs = (attempt.state.hiddenMs || 0) + Math.max(0, end - attempt.state.hiddenAt);
    attempt.state.hiddenAt = null;
  }
  timer.finalize(attempt.state, end);
  attempt.status = 'submitted';

  const { result, summaryRow, responseRows } = scoring.scoreAttempt({ exam, bank, user, attempt });
  const roleLabels = rolesFor(exam).filter((r) => (attempt.state.roles || []).includes(r.key)).map((r) => r.en);
  result.roles = roleLabels;
  result.rolesOther = attempt.state.rolesOther || '';
  summaryRow['Can Do (Roles)'] = [...roleLabels, ...(attempt.state.rolesOther ? [`Other: ${attempt.state.rolesOther}`] : [])].join('; ') || ((attempt.state.roles || []).includes('none') ? 'None of these' : '');
  summaryRow['Submitted By'] = reason === 'participant' ? 'Participant' : reason === 'time_over' ? 'Time over (automatic)' : 'Admin';
  await store.saveSubmission(exam, summaryRow, responseRows, (s2, r2) => scoring.buildAnalyticsSheet(s2, r2, bank, exam));
  attempt.result = result;
  await store.saveAttempt(exam.id, attempt);
  for (const r of reconciled) {
    await audit.log(req, 'ANSWER_SELECT', { username, exam_id: exam.id, ...r, recovered_at_submit: true });
  }
  if (Array.isArray(roles)) await audit.log(req, 'ROLES_SUBMITTED', { username, exam_id: exam.id, roles: attempt.state.roles, other: attempt.state.rolesOther });
  await audit.log(req, reason === 'participant' ? 'SUBMIT_CONFIRM' : reason === 'time_over' ? 'EXAM_AUTO_SUBMIT' : 'ADMIN_FORCE_SUBMIT', {
    username,
    exam_id: exam.id,
    total_time_seconds: result.totalSeconds,
    answers_submitted: result.answered,
    unanswered_count: result.questionCount - result.answered,
    answers_recovered_at_submit: reconciled.length,
    submitted_by: reason,
  });
  return { attempt, user };
}

router.post('/:id/submit', async (req, res) => {
  const exam = await loadAssignedExam(req, res);
  if (!exam) return;
  const { username } = req.session.user;
  const attempt = await store.getAttempt(exam.id, username);
  if (!attempt) return res.status(409).json({ error: 'Exam not started' });
  if (attempt.status === 'submitted') return res.json({ attempt: attemptInfo(exam, attempt) });
  const body = req.body || {};
  const { user } = await finishAttempt(req, exam, attempt, {
    answers: body.answers,
    flags: body.flags,
    roles: Array.isArray(body.roles) ? body.roles : undefined,
    rolesOther: body.rolesOther,
    reason: 'participant',
  });
  req.session.activeExam = null;
  await presence.touch(username, req.session.sid, { stage: 'submitted', examId: exam.id }).catch(() => {});
  res.json({ attempt: attemptInfo(exam, attempt), name: user.name, nameHi: user.nameHi || '' });
});

module.exports = router;
module.exports.publicExam = publicExam;
module.exports.isUnlocked = isUnlocked;
module.exports.attemptInfo = attemptInfo;
module.exports.finishAttempt = finishAttempt;
module.exports.isLive = isLive;
module.exports.waitingRoom = waitingRoom;
