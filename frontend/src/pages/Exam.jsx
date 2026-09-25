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
import LanguageToggle from '../components/LanguageToggle.jsx';
import QuestionPalette from '../components/QuestionPalette.jsx';
import Modal from '../components/Modal.jsx';
import Review from './Review.jsx';

/** "Section 1 — Knowledge", or just "Part 1" when names are hidden from participants. */
export function useSectionTitle() {
  const { t, pick } = useLang();
  return (s) => (s.name ? t('sectionLabel', { n: s.no, name: pick(s.name, s.nameHi) }) : t('partLabel', { n: s.no }));
}

function PreExam({ data, onBegin, busy, error }) {
  const { t, pick, formatDate } = useLang();
  const sectionTitle = useSectionTitle();
  const { exam, sections, totalQuestions } = data;
  const minutes = exam.estimatedMinutes || totalQuestions;
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
          <div className="stat"><span className="stat-value">{t('minutes', { n: minutes })}</span><span className="stat-label">{t('estimatedTime')}</span></div>
        </div>
        <h2>{named ? t('sections') : t('parts')}</h2>
        <ul className="section-list">
          {sections.map((s) => (
            <li key={s.no}>
              <strong>{sectionTitle(s)}</strong>
              <span className="muted"> — {t('questionsCount', { n: s.questionCount })}</span>
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
        {error && <div className="alert alert-error">{error}</div>}
        {exam.status === 'Active' ? (
          <>
            <p className="muted small">{t('beginNote')}</p>
            <button type="button" className="btn btn-primary btn-lg" onClick={onBegin} disabled={busy}>
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
  const [, setTick] = useState(0);

  const offsetRef = useRef(0);
  const queueRef = useRef(Promise.resolve());
  const pendingRef = useRef(0);
  const failedRef = useRef([]); // events that could not be saved yet; retried in the background
  const qTimeRef = useRef({}); // no -> accumulated ms this session
  const shownAtRef = useRef(Date.now());
  const currentRef = useRef(1);
  const langRef = useRef(lang);
  currentRef.current = current;

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
      setCurrent(view.progress.current || 1);
      setAnswers(answersNow);
      setFlags(flagsNow);
      setVisited({ ...view.progress.visited, [view.progress.current || 1]: true });
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
      setError(e.message || t('somethingWrong'));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await queueRef.current; // let pending saves finish first
      // Send every answer on screen too: the server recovers any that never saved.
      await api(`/exam/${id}/submit`, { method: 'POST', body: { answers, flags } });
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
        <PreExam data={data} onBegin={begin} busy={busy} error={error} />
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

  return (
    <div className="page exam-page">
      <header className="exam-header">
        <div className="exam-header-title">
          <strong>{data.exam.title}</strong>
          <span className="muted small">
            {user ? `${pick(user.name, user.nameHi)} · ` : ''}{t('elapsed')}: <span className="mono">{formatDuration(elapsed)}</span>
          </span>
        </div>
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
              progress={progress}
              onJump={(no) => goTo(no, 'review')}
              onBack={() => setMode('question')}
              onSubmit={openConfirm}
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
                <button type="button" className="btn btn-secondary" onClick={() => goTo(current - 1)} disabled={current === 1}>
                  ← {t('previous')}
                </button>
                {current < questions.length ? (
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
              <button type="button" className="btn btn-ghost" onClick={openReview}>
                {t('reviewAndSubmit')}
              </button>
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
        </main>
        <QuestionPalette
          questions={questions}
          sections={sections}
          current={mode === 'question' ? current : null}
          progress={progress}
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
