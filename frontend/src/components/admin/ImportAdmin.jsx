import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { recommendedInstructions } from './instructions.js';

const RECOMMENDED = recommendedInstructions(10);
const DEFAULT_INSTRUCTIONS_EN = RECOMMENDED.en;
const DEFAULT_INSTRUCTIONS_HI = RECOMMENDED.hi;

function summarize(db) {
  const sections = Object.entries(db.questions || {}).filter(([, v]) => Array.isArray(v));
  const roster = Array.isArray(db.staff_roster) ? db.staff_roster : [];
  const dims = Object.values(db.scoring_dimensions || {}).reduce((n, g) => n + Object.keys(g || {}).length, 0);
  return {
    ref: db.ref || '',
    generatedFor: db.generated_for || '',
    sections: sections.map(([k, v]) => ({ key: k, count: v.length })),
    questions: sections.reduce((n, [, v]) => n + v.length, 0),
    staff: roster.filter((p) => p.role !== 'admin' && p.username !== 'admin'),
    hasAdmin: roster.some((p) => p.role === 'admin' || p.username === 'admin'),
    rules: ((db.remarks_config || {}).thresholds || []).length,
    dims,
    timers: (db.system_config || {}).timer_per_question_seconds || {},
    unlockDays: (db.system_config || {}).result_unlock_days,
  };
}

export default function ImportAdmin() {
  const [db, setDb] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [resetPasswords, setResetPasswords] = useState(false);
  const [exams, setExams] = useState([]);
  const [target, setTarget] = useState('');
  useEffect(() => {
    api('/admin/exams').then((d) => setExams(d.exams)).catch(() => {});
  }, []);
  const updateId = target.startsWith('update:') ? target.slice(7) : '';
  const updateExam = exams.find((e) => e.id === updateId);
  const targetExam = updateId ? null : exams.find((e) => e.id === target);
  const [textPreview, setTextPreview] = useState(null);

  async function runTextUpdate(apply) {
    setBusy(true);
    setError('');
    try {
      setTextPreview(await api(`/admin/exams/${updateId}/update-text`, { method: 'POST', body: { database: db, apply } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const [meta, setMeta] = useState({
    title: 'Pass Section Knowledge & Behaviour Assessment 2026',
    team: 'Pass Section — LIAL',
    site: 'Lucknow International Airport',
    examDate: new Date().toISOString().slice(0, 10),
    status: 'Active',
    unlockDays: 10,
    partialCreditPct: 50,
    instructions: DEFAULT_INSTRUCTIONS_EN,
    instructionsHi: DEFAULT_INSTRUCTIONS_HI,
  });
  const set = (k) => (e) => setMeta((m) => ({ ...m, [k]: e.target.value }));

  async function onFile(e) {
    setError('');
    setDone(null);
    setDb(null);
    setInfo(null);
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed.questions || typeof parsed.questions !== 'object') throw new Error('No "questions" object in this file.');
      const s = summarize(parsed);
      setDb(parsed);
      setInfo(s);
      if (s.unlockDays) setMeta((m) => ({ ...m, unlockDays: s.unlockDays }));
    } catch (err) {
      setError(`Could not read this file: ${err.message}`);
    }
  }

  async function runImport() {
    setBusy(true);
    setError('');
    try {
      setDone(await api('/admin/import', { method: 'POST', body: { database: db, meta, resetPasswords, targetExamId: target || undefined } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Import question database</h1>
      <p className="muted">
        Upload the PassSection database JSON. It creates one exam with its sections, bilingual questions, answer key, behaviour
        scoring (preferred / concern options and interpretations), dimensions, remark rules and suggested times, then creates a
        login for every staff member and assigns them to the exam.
      </p>
      <div className="alert">
        Keep this file private. It contains the answer key and everyone's initial passwords. Upload it here only, and never
        commit it to the GitHub repository (which is public).
      </div>

      <div className="card stack">
        <div className="drop">
          <input type="file" accept="application/json,.json" onChange={onFile} aria-label="Database JSON file" />
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {info && (
          <div className="grid-2">
            <div>
              <h3>In this file</h3>
              <ul className="check-list">
                <li>{info.questions} questions — {info.sections.map((s) => `${s.key}: ${s.count}`).join(', ')}</li>
                {info.staff.length > 0 && <li>{info.staff.length} staff logins</li>}
                <li>{info.rules} remark rules, {info.dims} scoring dimensions</li>
                <li>
                  Suggested time: {Object.entries(info.timers).map(([k, v]) => `${k} ${v}s`).join(', ') || 'none'}
                </li>
                {info.ref && <li>Reference {info.ref}</li>}
              </ul>
              {info.hasAdmin && (
                <p className="muted small">
                  The file's <code>admin</code> row is skipped. The admin login always uses the <code>ADMIN_PASSWORD</code> setting on
                  the server.
                </p>
              )}
            </div>
            {info.staff.length > 0 && <div>
              <h3>Staff</h3>
              <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
                <table className="table table-compact">
                  <thead><tr><th>Name</th><th>Username</th><th>Shift</th></tr></thead>
                  <tbody>
                    {info.staff.map((p) => (
                      <tr key={p.username}><td>{p.name}</td><td className="mono">{p.username}</td><td>{p.shift}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>}
          </div>
        )}
      </div>

      {info && !done && (
        <fieldset className="card">
          <legend>Where should these questions go?</legend>
          <label className="field">
            <span>Import into</span>
            <select value={target} onChange={(e) => { setTarget(e.target.value); setTextPreview(null); }}>
              <option value="">A new exam</option>
              {exams.map((e) => (
                <option key={`u-${e.id}`} value={`update:${e.id}`}>
                  Update question wording in: {e.title}
                </option>
              ))}
              {exams.map((e) => (
                <option key={e.id} value={e.id} disabled={e.submitted > 0 || e.inProgress > 0}>
                  Add to: {e.title} ({e.questionCount} questions{e.submitted > 0 || e.inProgress > 0 ? ' — already started, locked' : ''})
                </option>
              ))}
            </select>
          </label>
          {updateExam && (
            <div className="stack-sm">
              <p className="small muted">
                Updates only the wording (questions, situations, options, explanations — English and Hindi) of questions whose ID
                matches (K01, B05…). Answer keys, scoring and results are not changed, so this is safe even after people have submitted.
              </p>
              {!textPreview && (
                <div><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => runTextUpdate(false)}>Preview changes</button></div>
              )}
              {textPreview && (
                textPreview.applied ? (
                  <div className="alert alert-ok">Updated the wording of {textPreview.changes.length} question(s) in “{updateExam.title}”.</div>
                ) : textPreview.changes.length === 0 ? (
                  <div className="alert">No wording differences found.</div>
                ) : (
                  <>
                    <div className="alert alert-warn">
                      {textPreview.changes.length} question(s) will change:{' '}
                      {textPreview.changes.map((c) => `${c.qid} (${c.fields.length})`).join(', ')}
                      {textPreview.notInExam.length > 0 && <div className="small">Not in this exam (ignored): {textPreview.notInExam.join(', ')}</div>}
                    </div>
                    <div><button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={() => runTextUpdate(true)}>Apply wording changes</button></div>
                  </>
                )
              )}
            </div>
          )}
          {targetExam && (
            <p className="small muted">
              The file's {info.sections.length} section(s) will be added after the existing {targetExam.sectionCount} section(s) of
              “{targetExam.title}”. Existing questions, remark rules and settings are kept; new qualities and suggested times are
              added. Only possible while nobody has started the exam.
            </p>
          )}
          {targetExam && (
            <div className="form-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={runImport} disabled={busy}>
                {busy ? 'Adding…' : `Add ${info.questions} questions to this exam`}
              </button>
            </div>
          )}
        </fieldset>
      )}

      {info && !done && !targetExam && !updateExam && (
        <fieldset className="card">
          <legend>Exam details</legend>
          <div className="form-grid">
            <label className="field span-2"><span>Exam title</span><input value={meta.title} onChange={set('title')} /></label>
            <label className="field"><span>Team</span><input value={meta.team} onChange={set('team')} /></label>
            <label className="field"><span>Site</span><input value={meta.site} onChange={set('site')} /></label>
            <label className="field"><span>Exam date</span><input type="date" value={meta.examDate} onChange={set('examDate')} /></label>
            <label className="field"><span>Status</span>
              <select value={meta.status} onChange={set('status')}>
                <option>Active</option>
                <option>Closed</option>
              </select>
            </label>
            <label className="field"><span>Result unlock delay (days)</span><input type="number" min="0" value={meta.unlockDays} onChange={set('unlockDays')} /></label>
            <label className="field"><span>Partial credit for acceptable behaviour answers (%)</span><input type="number" min="0" max="100" value={meta.partialCreditPct} onChange={set('partialCreditPct')} /></label>
            <label className="field span-2"><span>Instructions (English)</span><textarea rows={6} value={meta.instructions} onChange={set('instructions')} /></label>
            <label className="field span-2"><span>Instructions (Hindi)</span><textarea rows={6} value={meta.instructionsHi} onChange={set('instructionsHi')} /></label>
          </div>
          <label className="row-actions">
            <input type="checkbox" checked={resetPasswords} onChange={(e) => setResetPasswords(e.target.checked)} />
            <span>Reset passwords of staff who already have a login to the file's initial passwords</span>
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={runImport} disabled={busy}>
              {busy ? 'Importing…' : `Import ${info.questions} questions${info.staff.length ? ` and ${info.staff.length} staff` : ''}`}
            </button>
          </div>
        </fieldset>
      )}

      {done && (
        <div className="card stack">
          <div className="alert alert-ok">
            {done.appended ? `Added to “${done.exam.title}” — it now has ${done.totalQuestions} questions. ` : ''}
            Imported {done.questions} questions ({done.sections.map((s) => `${s.name} ${s.questions}`).join(', ')}). Created {done.created} new
            logins, updated {done.updated}, assigned {done.assigned} to the exam.
          </div>
          {done.warnings.length > 0 && (
            <div className="alert alert-warn">
              <ul>{done.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <div className="row-actions">
            <Link className="btn btn-primary" to={`/admin/exams/${done.exam.id}`}>Open the exam</Link>
            <Link className="btn btn-secondary" to={`/admin/exams/${done.exam.id}/edit`}>Review questions</Link>
          </div>
          <p className="muted small">
            Staff sign in with the username and initial password from your file. The exam is <b>{done.exam.status}</b>. Set it to
            Closed if you don't want anyone to start yet.
          </p>
        </div>
      )}
    </div>
  );
}
