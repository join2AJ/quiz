/**
 * Time limits. Each part gets the normal time to read and answer its
 * questions plus a few extra minutes; the whole exam gets the sum of the parts
 * plus a few more minutes (for the final review and questions).
 *
 * Parts are taken in order. A part ends when its time runs out or when the
 * participant finishes it; the next part starts at that moment. Nothing about
 * the clock is trusted from the browser: it is computed from the server-side
 * start time and the recorded part endings.
 */
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);

// Answers that were on their way when a part timed out are still accepted.
const GRACE_MS = 15 * 1000;

function words(t) {
  return String(t || '').trim().split(/\s+/).filter(Boolean).length;
}

/** Normal time for one question: the type's set time, or reading time if longer. */
function questionSeconds(q, exam) {
  const timers = (exam.config && exam.config.timerSeconds) || {};
  const base = num(timers[q.type], q.type === 'BEHAVIOUR' ? 45 : 30);
  const count = words(q.textEn) + words(q.scenarioEn) + (q.options || []).reduce((n, o) => n + words(o.en), 0);
  // About 150 words a minute plus a few seconds to decide.
  return Math.round(Math.max(base, 8 + count / 2.5));
}

function plan(exam, bank) {
  const cfg = exam.config || {};
  const sectionExtraMinutes = Math.max(0, num(cfg.sectionExtraMinutes, 5));
  const examExtraMinutes = Math.max(0, num(cfg.examExtraMinutes, 5));
  const sections = bank.sections
    .map((s) => {
      const qs = bank.questions.filter((q) => q.sectionNo === s.no);
      const normalSeconds = qs.reduce((t, q) => t + questionSeconds(q, exam), 0);
      // Rounded up to whole minutes so the limits are easy to state.
      const limitSeconds = Math.ceil((normalSeconds + sectionExtraMinutes * 60) / 60) * 60;
      return { no: s.no, questions: qs.length, normalSeconds, limitSeconds };
    })
    .filter((s) => s.questions > 0);
  return {
    timed: cfg.timeLimits !== false,
    sections,
    sectionExtraMinutes,
    examExtraMinutes,
    examLimitSeconds: sections.reduce((t, s) => t + s.limitSeconds, 0) + examExtraMinutes * 60,
  };
}

/**
 * Where the attempt is now: the open part and its deadline, or the final
 * stage (review, questions, submit) once every part has ended.
 */
function clock(p, attempt, now = Date.now()) {
  const started = new Date(attempt.startedAt).getTime();
  const examDeadline = started + p.examLimitSeconds * 1000;
  if (!p.timed) return { timed: false, phase: 'open', current: null, closed: [], examDeadline: null };
  const ends = ((attempt.state && attempt.state.sec) || {}).ends || {};
  let start = started;
  const closed = [];
  for (const s of p.sections) {
    const limitEnd = start + s.limitSeconds * 1000;
    const finished = ends[s.no] ? Math.min(Number(ends[s.no]), limitEnd) : null;
    if (!finished && now < limitEnd) {
      return {
        timed: true,
        phase: 'section',
        current: s.no,
        sectionStartedAt: new Date(start).toISOString(),
        sectionDeadline: new Date(limitEnd).toISOString(),
        examDeadline: new Date(examDeadline).toISOString(),
        closed: closed.map((c) => c.no),
        closedAt: Object.fromEntries(closed.map((c) => [c.no, c.end])),
      };
    }
    const end = finished || limitEnd;
    closed.push({ no: s.no, end, timedOut: !finished });
    start = end;
  }
  return {
    timed: true,
    phase: 'final',
    current: null,
    examDeadline: new Date(examDeadline).toISOString(),
    closed: closed.map((c) => c.no),
    closedAt: Object.fromEntries(closed.map((c) => [c.no, c.end])),
  };
}

/** May this question still be answered now? */
function canAnswer(c, sectionNo, now = Date.now()) {
  if (!c.timed) return true;
  if (c.phase === 'section' && c.current === sectionNo) return true;
  const closedAt = (c.closedAt || {})[sectionNo];
  return !!closedAt && now <= closedAt + GRACE_MS;
}

function expired(p, attempt, now = Date.now(), graceMs = 60 * 1000) {
  if (!p.timed) return false;
  return now > new Date(attempt.startedAt).getTime() + p.examLimitSeconds * 1000 + graceMs;
}

/** Plain public view of the plan (sent to the browser). */
function publicPlan(p) {
  return {
    timed: p.timed,
    sectionExtraMinutes: p.sectionExtraMinutes,
    examExtraMinutes: p.examExtraMinutes,
    examLimitSeconds: p.examLimitSeconds,
    sections: p.sections.map((s) => ({ no: s.no, questions: s.questions, limitSeconds: s.limitSeconds })),
  };
}

module.exports = { plan, clock, canAnswer, expired, publicPlan, questionSeconds, GRACE_MS };
