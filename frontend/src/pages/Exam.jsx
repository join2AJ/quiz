import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatDuration } from '../api.js';
import { useLang } from '../context/LanguageContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Answers are also kept on this device until submission, so a refresh or a
// network outage never loses what the participant chose.
function backupKey(examId, username) {
  return `psq_backup:${examId}:${username}`;
}
function readBackup(examId, username) {
  try {
    return JSON.parse(localStorage.getItem(backupKey(examId, username)) || 'null');
  } catch {
    return null;
  }
}
function writeBackup(examId, username, value) {
  try {
    if (value) localStorage.setItem(backupKey(examId, username), JSON.stringify(value));
    else localStorage.removeItem(backupKey(examId, username));
  } catch {
    /* storage unavailable — the server copy and submit-time recovery still apply */
  }
}
import TopBar from '../components/TopBar.jsx';

// Wait for queued autosaves, but never longer than `ms` (slow networks or a
// long queue must not block moving on; answers are also sent with the request).
const settle = (promise, ms = 6000) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
import LanguageToggle from '../components/LanguageToggle.jsx';
import QuestionPalette from '../components/QuestionPalette.jsx';
import Modal from '../components/Modal.jsx';
import Review from './Review.jsx';

/** "Section 1 — Knowledge", or just "Part 1" when names are hidden from participants. */
export function useSectionTitle() {
  const { t, pick } = useLang();
  return (s) => (s.name ? t('sectionLabel', { n: s.no, name: pick(s.name, s.nameHi) }) : t('partLabel', { n: s.no }));
}

const mins = (seconds) => Math.round((Number(seconds) || 0) / 60);

/** While `waiting`, polls until the examiner starts the exam (waiting room). */
function useLive(examId, waiting) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!waiting || live) return undefined;
    let stop = false;
    const check = () =>
      api(`/exam/${examId}/status`)
        .then((d) => !stop && d.live && setLive(true))
        .catch(() => {});
    const timer = setInterval(check, 5000);
    check();
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [examId, waiting, live]);
  return [!waiting || live, setLive];
}

function PreExam({ data, onBegin, busy, error, live }) {
  const { t, pick, formatDate } = useLang();
  const sectionTitle = useSectionTitle();
  const { exam, sections, totalQuestions } = data;
  const timing = data.timing || { timed: false, sections: [] };
  const minutes = timing.timed ? mins(timing.examLimitSeconds) : exam.estimatedMinutes || totalQuestions;
  const named = sections.some((s) => s.name);
  const instructions = pick(exam.instructions, exam.instructionsHi);
  return (
    <main className="container narrow">
      <div className="card">
        <h1>{exam.title}</h1>
        <dl className="meta-grid">
          {exam.team && (<div><dt>{t('team')}</dt><dd>{exam.team}</dd></div>)}
          {exam.site && (<div><dt>{t('site')}</dt><dd>{exam.site}</dd></div>)}
          {exam.examDate && (<div><dt>{t('date')}</dt><dd>{formatDate(exam.examDate)}</dd></div>)}
        </dl>
        <div className="stat-row">
          <div className="stat"><span className="stat-value">{totalQuestions}</span><span className="stat-label">{t('totalQuestions')}</span></div>
          <div className="stat"><span className="stat-value">{sections.length}</span><span className="stat-label">{named ? t('totalSections') : t('totalParts')}</span></div>
          <div className="stat"><span className="stat-value">{t('minutes', { n: minutes })}</span><span className="stat-label">{timing.timed ? t('totalTimeLimit') : t('estimatedTime')}</span></div>
        </div>
        <h2>{named ? t('sections') : t('parts')}</h2>
        <ul className="section-list">
          {sections.map((s) => (
            <li key={s.no}>
              <strong>{sectionTitle(s)}</strong>
              <span className="muted"> — {(() => {
                const lim = timing.timed && timing.sections.find((x) => x.no === s.no);
                return lim ? t('partTime', { time: t('minutes', { n: mins(lim.limitSeconds) }), n: s.questionCount }) : t('questionsCount', { n: s.questionCount });
              })()}</span>
              {pick(s.description, s.descriptionHi) && <p className="muted pre">{pick(s.description, s.descriptionHi)}</p>}
            </li>
          ))}
        </ul>
        {instructions && (
          <>
            <h2>{t('instructions')}</h2>
            <div className="instructions pre">{instructions}</div>
          </>
        )}
        {timing.timed && <div className="alert alert-info timed-rules">{t('timedRules')}</div>}
        {error && <div className="alert alert-error">{error}</div>}
        {exam.status === 'Active' ? (
          <>
            {live ? (
              exam.waitingRoom && <div className="alert alert-ok waiting-live" role="status">{t('waitingLive')}</div>
            ) : (
              <div className="waiting-room" role="status">
                <span className="waiting-dot" aria-hidden="true" />
                <div>
                  <strong>{t('waitingTitle')}</strong>
                  <p className="muted small">{t('waitingText')}</p>
                  <p className="muted small">{t('waitingCheck')}</p>
                </div>
              </div>
            )}
            <p className="muted small">{t('beginNote')}</p>
            <button type="button" className="btn btn-primary btn-lg" onClick={onBegin} disabled={busy || !live}>
              {t('beginExam')}
            </button>
          </>
        ) : (
          <div className="alert">{t('examNotOpen')}</div>
        )}
      </div>
    </main>
  );
}

export default function Exam() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, pick, lang } = useLang();
  const sectionTitle = useSectionTitle();
  const { user } = useAuth();
  const username = (user && user.username) || '';

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(1);
  const [answers, setAnswers] = useState({});
  const [flags, setFlags] = useState({});
  const [visited, setVisited] = useState({});
  const [mode, setMode] = useState('question');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('unclear');
  const [reportComment, setReportComment] = useState('');
  const [reportDone, setReportDone] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [notice, setNotice] = useState(null); // part closed by time
  const [roles, setRoles] = useState([]);
  const [rolesOther, setRolesOther] = useState('');
  const [rolesError, setRolesError] = useState(false);
  const [, setTick] = useState(0);
  const refreshingRef = useRef(false);
  const autoSubmitRef = useRef(false);

  const offsetRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const pendingRef = useRef(0);
  const failedRef = useRef([]); // events that could not be saved yet; retried in the background
  const qTimeRef = useRef({}); // no -> accumulated ms this session
  const shownAtRef = useRef(Date.now());
  const currentRef = useRef(1);
  const answersRef = useRef({});
  const langRef = useRef(lang);
  currentRef.current = current;
  answersRef.current = answers;

  const recoverRef = useRef([]); // events to re-send after loading a device backup

  const load = useCallback((view) => {
    offsetRef.current = new Date(view.serverTime).getTime() - Date.now();
    if (view.attempt.status === 'submitted') {
      writeBackup(id, username, null);
      navigate(`/exam/${id}/thank-you`, { replace: true });
      return;
    }
    setData(view);
    if (view.progress) {
      let answersNow = view.progress.answers;
      let flagsNow = view.progress.flags;
      // Merge a newer on-device copy (answers chosen while the network was down).
      const backup = readBackup(id, username);
      if (backup && backup.startedAt === view.attempt.startedAt) {
        const recovered = [];
        for (const [no, opt] of Object.entries(backup.answers || {})) {
          if (answersNow[no] !== opt) recovered.push({ type: 'answer', q: Number(no), option: opt });
        }
        for (const no of Object.keys(answersNow)) {
          if (!(backup.answers || {})[no]) recovered.push({ type: 'answer', q: Number(no), option: '' });
        }
        for (const no of new Set([...Object.keys(backup.flags || {}), ...Object.keys(flagsNow)])) {
          if (!!(backup.flags || {})[no] !== !!flagsNow[no]) recovered.push({ type: 'flag', q: Number(no), flagged: !!(backup.flags || {})[no] });
        }
        if (recovered.length) {
          answersNow = { ...(backup.answers || {}) };
          flagsNow = { ...(backup.flags || {}) };
          recoverRef.current = recovered;
        }
      }
      // With time limits, stay inside the open part (or go to the final review).
      let start = view.progress.current || 1;
      const c = view.clock;
      if (c && c.timed) {
        if (c.phase === 'final') setMode('review');
        else {
          const inPart = view.questions.filter((x) => x.sectionNo === c.current);
          if (!inPart.some((x) => x.no === start) && inPart.length) start = inPart[0].no;
          setMode('question');
        }
      }
      setCurrent(start);
      setAnswers(answersNow);
      setFlags(flagsNow);
      setVisited({ ...view.progress.visited, [start]: true });
      shownAtRef.current = Date.now();
    }
  }, [id, navigate, username]);

  useEffect(() => {
    api(`/exam/${id}`)
      .then(load)
      .catch((e) => setError(e.status === 404 ? e.message : t('somethingWrong')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const inProgress = data && data.attempt.status === 'in_progress';
  const [waitFlag, setWaitFlag] = useState(false);
  const [live, setLive] = useLive(id, !!data && !inProgress && (waitFlag || (data.exam.waitingRoom && !data.exam.live)));
  const clock = inProgress && data.clock && data.clock.timed ? data.clock : null;
  const nowServer = () => Date.now() + offsetRef.current;
  useEffect(() => {
    if (!inProgress) return undefined;
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [inProgress]);

  /** Queue an event so answers are saved in order; retries a few times. */
  const send = useCallback(
    (event) => {
      pendingRef.current += 1;
      setSaveState('saving');
      queueRef.current = queueRef.current.then(async () => {
        let ok = false;
        let permanent = false;
        for (let attempt = 0; attempt < 4 && !ok; attempt += 1) {
          try {
            await api(`/exam/${id}/event`, { method: 'POST', body: event, keepalive: true });
            ok = true;
          } catch (e) {
            if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) {
              permanent = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
          }
        }
        pendingRef.current -= 1;
        // Keep answers/flags that could not be saved and retry them in the background.
        if (!ok && !permanent && (event.type === 'answer' || event.type === 'flag')) failedRef.current.push(event);
        if (!ok) setSaveState('error');
        else if (pendingRef.current === 0 && failedRef.current.length === 0) setSaveState('saved');
      });
      return queueRef.current;
    },
    [id],
  );

  // Re-send anything recovered from the device backup, then keep retrying failed saves.
  useEffect(() => {
    if (!inProgress) return undefined;
    const recovered = recoverRef.current;
    recoverRef.current = [];
    recovered.forEach((ev) => send(ev));
    const timer = setInterval(() => {
      if (!failedRef.current.length || pendingRef.current) return;
      const retry = failedRef.current;
      failedRef.current = [];
      retry.forEach((ev) => send(ev));
    }, 5000);
    return () => clearInterval(timer);
  }, [inProgress, send]);

  // On-device backup of answers and flags.
  useEffect(() => {
    if (inProgress && username) writeBackup(id, username, { startedAt: data.attempt.startedAt, answers, flags });
  }, [answers, flags, inProgress, id, username, data]);

  // Time limits: when a part's time is over, move on; when the exam's time is over, submit.
  useEffect(() => {
    if (!clock) return;
    const now = nowServer();
    if (clock.phase === 'section' && now >= new Date(clock.sectionDeadline).getTime() + 500) {
      const closedNo = clock.current;
      refresh().then((view) => {
        if (view && view.clock && view.clock.timed) setNotice({ no: closedNo, final: view.clock.phase === 'final' });
      });
    } else if (clock.phase === 'final' && now >= new Date(clock.examDeadline).getTime() && !autoSubmitRef.current) {
      autoSubmitRef.current = true;
      setNotice({ over: true });
      submit();
    }
  });

  // Audit: language switches during the exam.
  useEffect(() => {
    const from = langRef.current;
    langRef.current = lang;
    if (inProgress && from !== lang) send({ type: 'lang', q: currentRef.current, from, to: lang });
  }, [lang, inProgress, send]);

  // Audit: leaving the exam tab (Page Visibility API).
  useEffect(() => {
    if (!inProgress) return undefined;
    const onVisibility = () => {
      send({ type: document.visibilityState === 'hidden' ? 'tab_hidden' : 'tab_visible', q: currentRef.current });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [inProgress, send]);

  function openReview() {
    setMode('review');
    send({ type: 'review' });
  }

  function openConfirm() {
    setConfirmOpen(true);
    send({ type: 'submit_attempt' });
  }

  function goTo(no, via = 'button') {
    if (!data || no < 1 || no > data.questions.length) return;
    if (clock && (clock.phase !== 'section' || data.questions[no - 1].sectionNo !== clock.current)) return;
    const now = Date.now();
    qTimeRef.current[current] = (qTimeRef.current[current] || 0) + (now - shownAtRef.current);
    shownAtRef.current = now;
    setMode('question');
    setPaletteOpen(false);
    if (no === current) return;
    setCurrent(no);
    setVisited((v) => ({ ...v, [no]: true }));
    send({ type: 'view', q: no, via });
    window.scrollTo({ top: 0 });
  }

  function choose(option) {
    setAnswers((a) => ({ ...a, [current]: option }));
    send({ type: 'answer', q: current, option });
  }

  function clearAnswer() {
    setAnswers((a) => {
      const next = { ...a };
      delete next[current];
      return next;
    });
    send({ type: 'answer', q: current, option: '' });
  }

  function toggleFlag() {
    const next = !flags[current];
    setFlags((f) => {
      const copy = { ...f };
      if (next) copy[current] = true;
      else delete copy[current];
      return copy;
    });
    send({ type: 'flag', q: current, flagged: next });
  }

  async function sendReport() {
    try {
      await api(`/exam/${id}/report`, { method: 'POST', body: { q: current, reason: reportReason, comment: reportComment, lang } });
      setReportDone(true);
    } catch {
      setReportDone(true); // do not block the exam if the report cannot be sent
    }
  }

  async function begin() {
    setBusy(true);
    setError('');
    try {
      load(await api(`/exam/${id}/start`, { method: 'POST', body: {} }));
    } catch (e) {
      if (e.code === 'WAITING') {
        setLive(false);
        setWaitFlag(true);
      }
      else setError(e.message || t('somethingWrong'));
    } finally {
      setBusy(false);
    }
  }

  /** Reload the attempt from the server (after a part ended). */
  const refresh = useCallback(async () => {
    if (refreshingRef.current) return null;
    refreshingRef.current = true;
    try {
      await settle(queueRef.current);
      const closing = data && data.clock && data.clock.timed && data.clock.phase === 'section' ? data.clock.current : null;
      if (closing) {
        const partAnswers = {};
        for (const x of data.questions) if (x.sectionNo === closing && answersRef.current[x.no]) partAnswers[x.no] = answersRef.current[x.no];
        await api(`/exam/${id}/section/next`, { method: 'POST', body: { section: closing, answers: partAnswers } }).catch(() => {});
      }
      const view = await api(`/exam/${id}`);
      load(view);
      return view;
    } catch {
      return null;
    } finally {
      refreshingRef.current = false;
    }
  }, [id, load, data]);

  async function finishPart() {
    if (!clock) return;
    setBusy(true);
    try {
      await settle(queueRef.current);
      const partAnswers = {};
      for (const x of data.questions) if (x.sectionNo === clock.current && answers[x.no]) partAnswers[x.no] = answers[x.no];
      load(await api(`/exam/${id}/section/next`, { method: 'POST', body: { section: clock.current, answers: partAnswers } }));
      window.scrollTo({ top: 0 });
    } catch {
      setError(t('somethingWrong'));
    } finally {
      setBusy(false);
      setFinishOpen(false);
    }
  }

  function toggleRole(key) {
    setRolesError(false);
    setRoles((list) => {
      if (key === 'none') return list.includes('none') ? [] : ['none'];
      const rest = list.filter((k) => k !== 'none');
      return rest.includes(key) ? rest.filter((k) => k !== key) : [...rest, key];
    });
  }

  function askSubmit() {
    if ((data.exam.roles || []).length && !roles.length && !rolesOther.trim()) {
      setRolesError(true);
      return;
    }
    openConfirm();
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await settle(queueRef.current); // let pending saves finish first (bounded)
      // Send every answer on screen too: the server recovers any that never saved.
      await api(`/exam/${id}/submit`, { method: 'POST', body: { answers, flags, roles, rolesOther } });
      writeBackup(id, username, null);
      navigate(`/exam/${id}/thank-you`, { replace: true });
    } catch {
      setError(t('somethingWrong'));
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  if (error && !data) {
    return (
      <div className="page">
        <TopBar />
        <main className="container narrow"><div className="alert alert-error">{error}</div></main>
      </div>
    );
  }
  if (!data) return <div className="center-page muted">{t('loading')}</div>;

  if (!inProgress) {
    return (
      <div className="page">
        <TopBar />
        <PreExam data={data} onBegin={begin} busy={busy} error={error} live={live} />
      </div>
    );
  }

  const { questions, sections, attempt } = data;
  const q = questions.find((x) => x.no === current) || questions[0];
  const section = sections.find((s) => s.no === q.sectionNo);
  const progress = { answers, flags, visited };
  const answeredCount = Object.keys(answers).length;
  const elapsed = (Date.now() + offsetRef.current - new Date(attempt.startedAt).getTime()) / 1000;
  const onQuestion = ((qTimeRef.current[current] || 0) + (Date.now() - shownAtRef.current)) / 1000;
  const suggested = Number((data.exam.timerSeconds || {})[q.type]) || 0;
  const scenario = pick(q.scenarioEn, q.scenarioHi);

  const saveLabel = { saving: t('saving'), saved: t('saved'), error: t('saveFailed') }[saveState];
  const nowS = nowServer();
  const partLeft = clock && clock.phase === 'section' ? Math.max(0, (new Date(clock.sectionDeadline).getTime() - nowS) / 1000) : null;
  const examLeft = clock ? Math.max(0, (new Date(clock.examDeadline).getTime() - nowS) / 1000) : null;
  const partQuestions = clock && clock.phase === 'section' ? questions.filter((x) => x.sectionNo === clock.current) : questions;
  const lastInPart = partQuestions.length ? partQuestions[partQuestions.length - 1].no : questions.length;
  const firstInPart = partQuestions.length ? partQuestions[0].no : 1;
  const isLastPart = clock && data.timing && clock.current === data.timing.sections[data.timing.sections.length - 1].no;
  const partUnanswered = partQuestions.filter((x) => !answers[x.no]).length;
  const timeTone = (left) => (left === null ? '' : left <= 60 ? 'time-bad' : left <= 300 ? 'time-warn' : '');

  return (
    <div className="page exam-page">
      <header className="exam-header">
        <div className="exam-header-title">
          <strong>{data.exam.title}</strong>
          <span className="muted small">
            {user ? `${pick(user.name, user.nameHi)} · ` : ''}{t('elapsed')}: <span className="mono">{formatDuration(elapsed)}</span>
          </span>
        </div>
        {clock && (
          <div className="exam-clock" role="timer">
            {partLeft !== null && (
              <span className={`clock-chip ${timeTone(partLeft)}`}>
                {t('partLabel', { n: clock.current })} · {t('timeLeftPart')} <b className="mono">{formatDuration(partLeft)}</b>
              </span>
            )}
            <span className={`clock-chip ${partLeft === null ? timeTone(examLeft) : ''}`}>
              {t('timeLeftExam')} <b className="mono">{formatDuration(examLeft)}</b>
            </span>
          </div>
        )}
        <div className="topbar-right">
          {saveLabel && <span className={`save-state save-${saveState}`} role="status">{saveLabel}</span>}
          <button type="button" className="btn btn-ghost btn-sm palette-toggle" onClick={() => setPaletteOpen(true)}>
            {t('showPalette')}
          </button>
          <LanguageToggle />
        </div>
        <div className="progress" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
        </div>
      </header>

      <div className="exam-body">
        <main className="exam-main">
          {mode === 'review' ? (
            <Review
              questions={questions}
              sections={sections}
              progress={progress}
              timed={!!clock}
              onJump={(no) => goTo(no, 'review')}
              onBack={clock ? null : () => setMode('question')}
              onSubmit={askSubmit}
              roleList={data.exam.roles || []}
              roles={roles}
              onToggleRole={toggleRole}
              rolesOther={rolesOther}
              onRolesOther={(v) => {
                setRolesOther(v);
                setRolesError(false);
              }}
              rolesError={rolesError}
            />
          ) : (
            <div className="card question-card">
              <div className="question-meta">
                <span className="section-chip">{sectionTitle(section)}</span>
                <span className="muted">{t('questionOf', { n: q.no, total: questions.length })}</span>
              </div>
              {scenario && (
                <div className="scenario pre">
                  <span className="scenario-label">{t('scenario')}</span>
                  {scenario}
                </div>
              )}
              <h2 className="question-text pre">{pick(q.textEn, q.textHi)}</h2>
              <div className="options" role="radiogroup" aria-label={t('question')}>
                {q.options.map((o) => (
                  <label key={o.key} className={`option ${answers[q.no] === o.key ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name={`q-${q.no}`}
                      value={o.key}
                      checked={answers[q.no] === o.key}
                      onChange={() => choose(o.key)}
                    />
                    <span className="option-key">{o.key}</span>
                    <span className="option-text">{pick(o.en, o.hi)}</span>
                  </label>
                ))}
              </div>
              <div className="question-tools">
                <button
                  type="button"
                  className={`btn btn-flag ${flags[q.no] ? 'on' : ''}`}
                  aria-pressed={!!flags[q.no]}
                  onClick={toggleFlag}
                >
                  ⚑ {flags[q.no] ? t('flagged') : t('flagQuestion')}
                </button>
                {answers[q.no] && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearAnswer}>
                    {t('clearAnswer')}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setReportReason('unclear');
                    setReportComment('');
                    setReportDone(false);
                    setReportOpen(true);
                  }}
                >
                  ⚠ {t('reportProblem')}
                </button>
                <span className={`muted small q-timer ${suggested && onQuestion > suggested ? 'over' : ''}`}>
                  {t('timeOnQuestion', { time: formatDuration(onQuestion) })}
                  {suggested > 0 && <> · {t('suggestedTime', { time: formatDuration(suggested) })}</>}
                </span>
              </div>
              <div className="question-nav">
                <button type="button" className="btn btn-secondary" onClick={() => goTo(current - 1)} disabled={current === firstInPart}>
                  ← {t('previous')}
                </button>
                {clock && current === lastInPart ? (
                  <button type="button" className="btn btn-primary" onClick={() => setFinishOpen(true)}>
                    {isLastPart ? t('finishLastPart') : t('finishPart')} →
                  </button>
                ) : current < questions.length ? (
                  <button type="button" className="btn btn-primary" onClick={() => goTo(current + 1)}>
                    {t('next')} →
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={openReview}>
                    {t('reviewAndSubmit')}
                  </button>
                )}
              </div>
            </div>
          )}
          {mode === 'question' && (
            <div className="review-link">
              {clock ? (
                <button type="button" className="btn btn-ghost" onClick={() => setFinishOpen(true)}>
                  {isLastPart ? t('finishLastPart') : t('finishPart')}
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={openReview}>
                  {t('reviewAndSubmit')}
                </button>
              )}
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
        </main>
        <QuestionPalette
          questions={questions}
          sections={sections}
          current={mode === 'question' ? current : null}
          progress={progress}
          clock={clock}
          onJump={(no) => goTo(no, 'palette')}
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
        />
        {paletteOpen && <div className="palette-backdrop" onClick={() => setPaletteOpen(false)} />}
      </div>

      {reportOpen && (
        <Modal title={t('reportTitle')} onClose={() => setReportOpen(false)}>
          {reportDone ? (
            <>
              <div className="alert alert-ok">{t('reportThanks')}</div>
              <div className="modal-actions">
                <button type="button" className="btn btn-primary" onClick={() => setReportOpen(false)}>OK</button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">{t('questionOf', { n: current, total: questions.length })}</p>
              <div className="stack-sm">
                {['unclear', 'translation', 'multiple_correct', 'no_correct', 'spelling', 'other'].map((r) => (
                  <label key={r} className={`option ${reportReason === r ? 'selected' : ''}`}>
                    <input type="radio" name="report-reason" checked={reportReason === r} onChange={() => setReportReason(r)} />
                    <span className="option-text">{t(`reportReason_${r}`)}</span>
                  </label>
                ))}
              </div>
              <label className="field" style={{ marginTop: '0.75rem' }}>
                <span>{t('reportComment')}</span>
                <textarea rows={3} maxLength={1000} value={reportComment} onChange={(e) => setReportComment(e.target.value)} />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setReportOpen(false)}>{t('cancel')}</button>
                <button type="button" className="btn btn-primary" onClick={sendReport}>{t('reportSend')}</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {finishOpen && clock && (
        <Modal title={t('finishPartTitle', { n: clock.current })} onClose={() => !busy && setFinishOpen(false)}>
          <p>{t('finishPartText', { n: clock.current })}</p>
          {partUnanswered > 0 && <div className="alert alert-warn">{t('finishPartUnanswered', { n: partUnanswered })}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setFinishOpen(false)} disabled={busy}>{t('cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={finishPart} disabled={busy}>{t('finishPartYes')}</button>
          </div>
        </Modal>
      )}

      {notice && (
        <Modal title={notice.over ? t('examTimeOver') : t('partClosedTitle', { n: notice.no })} onClose={() => !notice.over && setNotice(null)}>
          {!notice.over && <p>{notice.final ? t('partClosedFinal') : t('partClosedText', { n: notice.no })}</p>}
          {!notice.over && (
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setNotice(null)}>OK</button>
            </div>
          )}
        </Modal>
      )}

      {confirmOpen && (
        <Modal title={t('confirmTitle')} onClose={() => !busy && setConfirmOpen(false)}>
          <p>{t('confirmText')}</p>
          {questions.length - answeredCount > 0 && (
            <div className="alert alert-warn">{t('unansweredWarning', { n: questions.length - answeredCount })}</div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmOpen(false)} disabled={busy}>
              {t('cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
              {busy ? t('submitting') : t('confirmSubmit')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
