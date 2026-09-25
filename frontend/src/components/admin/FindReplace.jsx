import { useState } from 'react';
import { api } from '../../api.js';
import Modal from '../Modal.jsx';

/** Replace a word or phrase everywhere in an exam (title, instructions, questions, options, explanations). */
export default function FindReplace({ examId, onClose, onDone }) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(apply) {
    setBusy(true);
    setError('');
    try {
      const d = await api(`/admin/exams/${examId}/replace`, { method: 'POST', body: { find, replace, apply } });
      setPreview(d);
      if (d.applied && onDone) onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Find & replace text in this exam" onClose={onClose}>
      <div className="stack modal-scroll">
        <p className="muted small">
          Changes the exact text (case-sensitive) everywhere: title, team, site, instructions, section names, questions,
          situations, options, explanations and interpretations. Preview first, then apply.
        </p>
        <div className="form-grid">
          <label className="field"><span>Find</span><input value={find} onChange={(e) => { setFind(e.target.value); setPreview(null); }} placeholder="LBIA" /></label>
          <label className="field"><span>Replace with</span><input value={replace} onChange={(e) => { setReplace(e.target.value); setPreview(null); }} placeholder="LIAL" /></label>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {preview && (
          preview.applied ? (
            <div className="alert alert-ok">Replaced {preview.total} occurrence(s) in {preview.fields.length} field(s).</div>
          ) : preview.total === 0 ? (
            <div className="alert">No matches for “{find}”.</div>
          ) : (
            <>
              <div className="alert alert-warn">{preview.total} occurrence(s) in {preview.fields.length} field(s) will change:</div>
              <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
                <table className="table table-compact">
                  <thead><tr><th>Where</th><th>Before</th><th>After</th></tr></thead>
                  <tbody>
                    {preview.fields.map((f) => (
                      <tr key={f.field}><td className="nowrap small">{f.field}</td><td className="small">{f.before}</td><td className="small">{f.after}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-secondary" disabled={busy || find.trim().length < 2} onClick={() => run(false)}>Preview</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !preview || preview.applied || preview.total === 0}
            onClick={() => run(true)}
          >
            Replace all
          </button>
        </div>
      </div>
    </Modal>
  );
}
