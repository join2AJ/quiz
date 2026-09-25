/**
 * Timing capture. All timestamps are taken from the server clock when the
 * participant's browser reports an event, so a participant cannot tamper with
 * their own timings.
 *
 * Attempt state shape:
 *   {
 *     current: <question no currently displayed>,
 *     lastViewAt: <ms epoch when `current` was displayed>,
 *     q: { [no]: { firstViewAt, visibleMs, answer, firstAnswerAt, lastAnswerAt, changes, flagged } }
 *   }
 */

// A single uninterrupted view longer than this is assumed to be an idle tab.
const MAX_SEGMENT_MS = 30 * 60 * 1000;

function qState(state, no) {
  state.q = state.q || {};
  if (!state.q[no]) {
    state.q[no] = {
      firstViewAt: null,
      visibleMs: 0,
      answer: '',
      firstAnswerAt: null,
      lastAnswerAt: null,
      changes: 0,
      flagged: false,
    };
  }
  return state.q[no];
}

function closeSegment(state, now) {
  if (state.current && state.lastViewAt) {
    const q = qState(state, state.current);
    q.visibleMs += Math.min(MAX_SEGMENT_MS, Math.max(0, now - state.lastViewAt));
  }
}

function recordView(state, no, now = Date.now()) {
  if (state.current === no && state.lastViewAt) return state;
  closeSegment(state, now);
  const q = qState(state, no);
  if (!q.firstViewAt) q.firstViewAt = now;
  state.current = no;
  state.lastViewAt = now;
  return state;
}

function recordAnswer(state, no, option, now = Date.now()) {
  recordView(state, no, now);
  const q = qState(state, no);
  if (q.answer === option) return state;
  if (q.answer) q.changes += 1;
  q.answer = option;
  if (!q.firstAnswerAt) q.firstAnswerAt = now;
  q.lastAnswerAt = now;
  return state;
}

function recordFlag(state, no, flagged, now = Date.now()) {
  recordView(state, no, now);
  qState(state, no).flagged = !!flagged;
  return state;
}

function finalize(state, now = Date.now()) {
  closeSegment(state, now);
  state.lastViewAt = null;
  return state;
}

/**
 * Compute every timing metric required for the Excel output.
 * @returns {{ totalSeconds, perQuestion: Map<no, {...}>, perSection: Map<sectionNo, seconds>, flaggedSeconds }}
 */
function computeTimings(bank, state, startedAt, submittedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(submittedAt).getTime();
  const perQuestion = new Map();
  const perSection = new Map();
  let flaggedMs = 0;

  for (const q of bank.questions) {
    const s = (state.q || {})[q.no] || {};
    // Spec: time from first display to the last time the answer was selected/changed.
    const toAnswerMs = s.firstViewAt && s.lastAnswerAt ? Math.max(0, s.lastAnswerAt - s.firstViewAt) : 0;
    const visibleMs = s.visibleMs || 0;
    perQuestion.set(q.no, {
      seconds: Math.round((s.lastAnswerAt ? toAnswerMs : visibleMs) / 1000),
      activeSeconds: Math.round(visibleMs / 1000),
      changes: s.changes || 0,
      flagged: !!s.flagged,
      answer: s.answer || '',
      visited: !!s.firstViewAt,
    });
    if (s.flagged) flaggedMs += visibleMs;
  }

  for (const sec of bank.sections) {
    const qs = bank.questions.filter((q) => q.sectionNo === sec.no).map((q) => (state.q || {})[q.no] || {});
    const firstViews = qs.map((s) => s.firstViewAt).filter(Boolean);
    const lastAnswers = qs.map((s) => s.lastAnswerAt).filter(Boolean);
    let seconds = 0;
    if (firstViews.length && lastAnswers.length) {
      seconds = Math.max(0, Math.round((Math.max(...lastAnswers) - Math.min(...firstViews)) / 1000));
    } else {
      seconds = Math.round(qs.reduce((sum, s) => sum + (s.visibleMs || 0), 0) / 1000);
    }
    perSection.set(sec.no, seconds);
  }

  return {
    totalSeconds: Math.max(0, Math.round((end - start) / 1000)),
    perQuestion,
    perSection,
    flaggedSeconds: Math.round(flaggedMs / 1000),
  };
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

module.exports = { recordView, recordAnswer, recordFlag, finalize, computeTimings, formatDuration };
