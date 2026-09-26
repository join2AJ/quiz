import { useCallback, useEffect, useState } from 'react';
import { api, formatDuration } from '../../api.js';
import { Chip, Kpi, KpiRow } from './Insights.jsx';

const LOGIN = {
  online: ['good', 'Online'],
  away: ['warn', 'Inactive'],
  logged_out: ['muted', 'Logged out'],
  timed_out: ['warn', 'Timed out'],
  never: ['muted', 'Never logged in'],
};

function ago(iso, now) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

function where(p) {
  if (p.exam === 'submitted') return <Chip tone="good">Submitted {time(p.submittedAt)}</Chip>;
  if (p.exam === 'in_progress') {
    if (p.timeOver) return <Chip tone="bad">Time over — not submitted</Chip>;
    const left = p.secondsLeft !== null && p.secondsLeft !== undefined ? ` · ${formatDuration(p.secondsLeft)} left` : '';
    return (
      <Chip tone="info">
        {p.phase === 'final' ? 'Final review' : p.part ? `Part ${p.part}` : 'In exam'} · {p.answered} answered{left}
      </Chip>
    );
  }
  if (p.login === 'online' && p.stage === 'waiting') return <Chip tone="warn">Waiting room</Chip>;
  if (p.login === 'online') return <Chip tone="muted">Logged in, not in exam</Chip>;
  return <span className="muted">—</span>;
}

const FILTERS = [
  ['all', 'All', () => true],
  ['online', 'Online', (p) => p.login === 'online'],
  ['waiting', 'Waiting', (p) => p.login === 'online' && p.stage === 'waiting' && p.exam === 'not_started'],
  ['exam', 'Taking exam', (p) => p.exam === 'in_progress'],
  ['done', 'Submitted', (p) => p.exam === 'submitted'],
  ['absent', 'Not logged in', (p) => p.login === 'never' || (p.login !== 'online' && p.exam === 'not_started')],
];

/** Live view: who is logged in, waiting, taking the exam or done. */
export default function LiveTab({ examId, onChanged }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api(`/admin/exams/${examId}/live`)
      .then((x) => {
        setD(x);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [examId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  async function goLive(live) {
    const msg = live
      ? 'Start the exam now? Everyone in the waiting room can begin immediately.'
      : 'Put the exam back to waiting? People who have not begun will have to wait again. Anyone already taking it continues.';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await api(`/admin/exams/${examId}/go-live`, { method: 'POST', body: { live } });
      load();
      if (onChanged) onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function forceSubmit(p) {
    if (!window.confirm(`Submit ${p.name}'s exam now with the answers saved so far?`)) return;
    await api(`/admin/exams/${examId}/attempts/${encodeURIComponent(p.username)}/submit`, { method: 'POST', body: {} });
    load();
    if (onChanged) onChanged();
  }

  if (error && !d) return <div className="alert alert-error">{error}</div>;
  if (!d) return <p className="muted">Loading…</p>;

  const now = new Date(d.serverTime).getTime();
  const count = (key) => d.people.filter(FILTERS.find((f) => f[0] === key)[2]).length;
  const rows = d.people.filter(FILTERS.find((f) => f[0] === filter)[2]);
  const t = d.timing;

  return (
    <div className="stack">
      <section className={`live-control ${d.exam.live ? 'live-on' : 'live-off'}`}>
        <div>
          <div className="live-state">
            <span className={`live-dot ${d.exam.live ? 'on' : ''}`} aria-hidden="true" />
            {d.exam.status !== 'Active'
              ? `Exam is ${d.exam.status} — participants cannot start.`
              : !d.exam.waitingRoom
                ? 'No waiting room — participants can start as soon as they log in.'
                : d.exam.live
                  ? `Exam started at ${time(d.exam.liveAt)} — participants can begin.`
                  : `Waiting room — ${count('waiting')} waiting. Participants cannot begin until you start the exam.`}
          </div>
          {t.timed && (
            <div className="small muted" style={{ marginTop: '0.35rem' }}>
              Time limits: {t.sections.map((s) => `Part ${s.no} ${Math.round(s.limitSeconds / 60)} min`).join(' · ')} · whole exam {Math.round(t.examLimitSeconds / 60)} min
              (normal time + {t.sectionExtraMinutes} min per part, + {t.examExtraMinutes} min overall)
            </div>
          )}
        </div>
        {d.exam.waitingRoom && d.exam.status === 'Active' && (
          d.exam.live ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => goLive(false)} disabled={busy}>Put back to waiting</button>
          ) : (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => goLive(true)} disabled={busy}>▶ Start exam for everyone</button>
          )
        )}
      </section>

      <KpiRow>
        <Kpi label="Online now" value={count('online')} tone="good" sub={`of ${d.people.length} assigned`} />
        <Kpi label="Waiting" value={count('waiting')} tone={count('waiting') ? 'warn' : 'info'} />
        <Kpi label="Taking exam" value={count('exam')} tone="info" />
        <Kpi label="Submitted" value={count('done')} tone="good" />
        <Kpi label="Not logged in" value={count('absent')} tone={count('absent') ? 'warn' : 'good'} />
      </KpiRow>

      <div className="results-head">
        <div className="segmented" role="group" aria-label="Filter">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {label} ({count(k)})
            </button>
          ))}
        </div>
        <span className="small muted">Refreshes every 10 seconds · one device per person</span>
      </div>

      <div className="table-wrap">
        <table className="table table-roomy">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Name</th>
              <th>Login</th>
              <th>Where</th>
              <th className="hide-sm">Device</th>
              <th>Logged in</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const [tone, label] = LOGIN[p.login] || ['muted', p.login];
              return (
                <tr key={p.username}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <div className="cell-name">{p.name}</div>
                    <div className="small muted">{[p.username, p.designation, p.shift].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td><Chip tone={tone}>{label}</Chip>{p.logoutAt && p.login !== 'online' && <div className="small muted">at {time(p.logoutAt)}</div>}</td>
                  <td>{where(p)}</td>
                  <td className="small hide-sm">{p.device || '—'}</td>
                  <td className="small nowrap">{time(p.loginAt)}</td>
                  <td className="small nowrap">{ago(p.lastSeen, now)}</td>
                  <td>
                    {p.exam === 'in_progress' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => forceSubmit(p)}>Submit now</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="muted">Nobody here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
