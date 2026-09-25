import { useState } from 'react';
import { api } from '../../api.js';

/** Add a single participant (optionally assigned to an exam). */
export function AddParticipantForm({ exams, examId: fixedExamId, onDone }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', examId: fixedExamId || '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const d = await api('/admin/participants', { method: 'POST', body: { ...form, examId: fixedExamId || form.examId } });
      setMsg({ ok: true, text: d.created ? `Added ${form.username}.` : `Updated ${form.username}.` });
      setForm((f) => ({ ...f, name: '', username: '', password: '' }));
      onDone && onDone();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label className="field"><span>Full name</span><input value={form.name} onChange={set('name')} placeholder="e.g. Asha Singh" /></label>
      <label className="field"><span>Username</span><input value={form.username} onChange={set('username')} autoCapitalize="none" placeholder="e.g. asha.singh" required /></label>
      <label className="field"><span>Password</span><input value={form.password} onChange={set('password')} placeholder="min. 4 characters" /></label>
      {!fixedExamId && exams && (
        <label className="field">
          <span>Assign to exam</span>
          <select value={form.examId} onChange={set('examId')}>
            <option value="">— none —</option>
            {exams.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        </label>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || !form.username}>Add participant</button>
        <span className="muted small">Existing username? Name/password are updated and the exam is assigned.</span>
      </div>
      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text}</div>}
    </form>
  );
}

/** Bulk upload participants from a CSV with columns name, username, password. */
export function CsvUpload({ exams, examId: fixedExamId, onDone }) {
  const [csv, setCsv] = useState('');
  const [examId, setExamId] = useState(fixedExamId || '');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const file = e.target.files[0];
    if (file) setCsv(await file.text());
  }

  // Upload in batches of 50 rows so each request stays well within the
  // serverless time limit (passwords are hashed server-side).
  async function upload() {
    setBusy(true);
    setResult(null);
    const lines = csv.split(/\r?\n/);
    const header = lines[0];
    const body = lines.slice(1).filter((l) => l.trim());
    const total = { created: 0, updated: 0, assigned: 0, errors: [] };
    try {
      for (let i = 0; i < body.length; i += 50) {
        const chunk = [header, ...body.slice(i, i + 50)].join('\n');
        const d = await api('/admin/participants/bulk', {
          method: 'POST',
          body: { csv: chunk, examId: fixedExamId || examId, lineOffset: i },
        });
        total.created += d.created;
        total.updated += d.updated;
        total.assigned += d.assigned;
        total.errors.push(...d.errors);
        setResult({ ...total, progress: Math.min(body.length, i + 50), totalRows: body.length });
      }
      setResult({ ...total });
      if (!total.errors.length) setCsv('');
    } catch (err) {
      setResult({ ...total, errors: [...total.errors, err.message] });
    } finally {
      setBusy(false);
      onDone && onDone();
    }
  }

  return (
    <div className="stack">
      <p className="muted small">
        CSV with a header row: <code>name,username,password</code>. Choose a file or paste the text.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} />
      <textarea rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'name,username,password\nAsha Singh,asha.singh,Welcome@123'} />
      {!fixedExamId && exams && (
        <label className="field">
          <span>Assign all to exam</span>
          <select value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">— none —</option>
            {exams.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        </label>
      )}
      <div>
        <button type="button" className="btn btn-primary" onClick={upload} disabled={busy || !csv.trim()}>
          {busy ? 'Uploading…' : 'Upload CSV'}
        </button>
      </div>
      {result && (
        <div className={`alert ${result.errors.length ? 'alert-warn' : 'alert-ok'}`}>
          {result.totalRows && busy ? `Uploading… ${result.progress}/${result.totalRows} rows. ` : ''}
          Created {result.created}, updated {result.updated}, newly assigned {result.assigned}.
          {result.errors.length > 0 && (
            <ul>{result.errors.map((er) => <li key={er}>{er}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}
