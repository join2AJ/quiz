import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';

export default function AuditAdmin() {
  const [exams, setExams] = useState([]);
  const [filters, setFilters] = useState({ examId: '', username: '', event: '' });
  const [entries, setEntries] = useState([]);
  const [events, setEvents] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const query = useCallback(
    (beforeSeq) => {
      const qs = new URLSearchParams({ limit: '100' });
      for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
      if (beforeSeq) qs.set('beforeSeq', String(beforeSeq));
      return api(`/admin/audit?${qs}`);
    },
    [filters],
  );

  const load = useCallback(() => {
    setError('');
    query()
      .then((d) => {
        setEntries(d.entries);
        setEvents(d.events);
        setHasMore(d.hasMore);
      })
      .catch((e) => setError(e.message));
  }, [query]);

  useEffect(() => {
    api('/admin/exams').then((d) => setExams(d.exams));
  }, []);
  useEffect(load, [load]);

  async function more() {
    const d = await query(entries[entries.length - 1].Seq);
    setEntries((e) => [...e, ...d.entries]);
    setHasMore(d.hasMore);
  }

  async function verify() {
    setBusy(true);
    try {
      setCheck(await api('/admin/audit/verify'));
    } catch (e) {
      setCheck({ ok: false, reason: e.message });
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const dl = `/api/admin/audit/download${filters.examId ? `?examId=${encodeURIComponent(filters.examId)}` : ''}`;

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Audit log</h1>
        <div className="row-actions">
          <button type="button" className="btn btn-secondary" onClick={verify} disabled={busy}>
            {busy ? 'Checking…' : 'Verify integrity'}
          </button>
          <a className="btn btn-primary" href={dl}>⬇ Download Excel</a>
        </div>
      </div>
      <p className="muted small">
        Every login, exam action and admin action is recorded. Each entry contains the SHA-256 hash of the previous one, so any
        edit or deletion breaks the chain. “Verify integrity” recomputes every hash. IP addresses are stored only as hashes.
      </p>
      {check && (
        <div className={`alert ${check.ok ? 'alert-ok' : 'alert-error'}`} role="status">
          {check.ok
            ? `Chain intact — all ${check.count} entries verified.`
            : `Chain broken${check.brokenAt ? ` at entry #${check.brokenAt}` : ''}: ${check.reason}`}
        </div>
      )}
      <div className="card">
        <div className="form-grid">
          <label className="field"><span>Exam</span>
            <select value={filters.examId} onChange={set('examId')}>
              <option value="">All exams</option>
              {exams.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </label>
          <label className="field"><span>Username</span><input value={filters.username} onChange={set('username')} placeholder="any" /></label>
          <label className="field"><span>Event</span>
            <select value={filters.event} onChange={set('event')}>
              <option value="">All events</option>
              {events.map((e) => <option key={e}>{e}</option>)}
            </select>
          </label>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr><th className="num">#</th><th>Time</th><th>Event</th><th>User</th><th>Details</th><th>Hash</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.Seq}>
                  <td className="num">{e.Seq}</td>
                  <td className="nowrap small">{new Date(e['Timestamp (UTC)']).toLocaleString()}</td>
                  <td className="nowrap"><code>{e.Event}</code></td>
                  <td className="mono">{e.Username}</td>
                  <td className="small">{e.Details}</td>
                  <td className="hash" title={e.Hash}>{e.Hash.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 && !error && <p className="muted">No entries.</p>}
        {hasMore && (
          <div className="row-actions"><button type="button" className="btn btn-ghost" onClick={more}>Load older entries</button></div>
        )}
      </div>
    </div>
  );
}
