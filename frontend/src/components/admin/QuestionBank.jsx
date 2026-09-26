import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import Modal from '../Modal.jsx';

const LETTERS = ['A', 'B', 'C', 'D'];

/** How an option scores, for the admin view. */
function optionKind(q, k) {
  if (q.correct === k) return ['best', 'Correct / best answer'];
  if ((q.fullCredit || []).includes(k)) return ['full', 'Also full credit'];
  if ((q.partial || []).includes(k)) return ['partial', 'Partial credit'];
  if ((q.concern || []).includes(k)) return ['concern', 'Concern'];
  if ((q.neutral || []).includes(k)) return ['neutral', 'Neutral'];
  return ['wrong', ''];
}

/** Edit one question on screen: wording (EN + HI), options, correct answer, explanation, topic, tags. */
function QuestionEditModal({ examId, q, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    textEn: q.textEn || '',
    textHi: q.textHi || '',
    scenarioEn: q.scenarioEn || '',
    scenarioHi: q.scenarioHi || '',
    category: q.category || '',
    explanation: q.explanation || '',
    explanationHi: q.explanationHi || '',
    options: LETTERS.map((_, i) => ({ en: (q.options[i] || {}).en || '', hi: (q.options[i] || {}).hi || '' })),
    correct: q.correct,
    tags: (q.tags || []).join(', '),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setOpt = (i, lang) => (e) =>
    setF((x) => ({ ...x, options: x.options.map((o, j) => (j === i ? { ...o, [lang]: e.target.value } : o)) }));

  async function save() {
    if (f.correct !== q.correct && !window.confirm(`Change the correct answer from ${q.correct} to ${f.correct}? Scores of people who already submitted are not recalculated.`)) return;
    setBusy(true);
    setError('');
    try {
      const r = await api(`/admin/exams/${examId}/questions/${q.no}`, {
        method: 'PATCH',
        body: { ...f, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) },
      });
      onSaved(r);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Edit Q${q.no}${q.qid ? ` (${q.qid})` : ''}`} onClose={() => !busy && onClose()}>
      <div className="stack modal-scroll qe-form">
        <div className="qe-grid">
          <label className="field"><span>Question (English)</span><textarea rows={4} value={f.textEn} onChange={set('textEn')} /></label>
          <label className="field"><span>Question (Hindi)</span><textarea rows={4} value={f.textHi} onChange={set('textHi')} lang="hi" /></label>
          {(q.scenarioEn || q.scenarioHi) && (
            <>
              <label className="field"><span>Situation (English)</span><textarea rows={3} value={f.scenarioEn} onChange={set('scenarioEn')} /></label>
              <label className="field"><span>Situation (Hindi)</span><textarea rows={3} value={f.scenarioHi} onChange={set('scenarioHi')} lang="hi" /></label>
            </>
          )}
        </div>
        <div className="qe-options">
          {LETTERS.map((k, i) => (
            <div key={k} className={`qe-option ${f.correct === k ? 'qe-correct' : ''}`}>
              <label className="qe-radio" title="Correct answer">
                <input type="radio" name="qe-correct" checked={f.correct === k} onChange={() => setF((x) => ({ ...x, correct: k }))} />
                <span className="option-key">{k}</span>
                {f.correct === k && <span className="small kind-correct">Correct</span>}
              </label>
              <textarea rows={3} aria-label={`Option ${k} English`} placeholder="English" value={f.options[i].en} onChange={setOpt(i, 'en')} />
              <textarea rows={3} aria-label={`Option ${k} Hindi`} placeholder="Hindi" lang="hi" value={f.options[i].hi} onChange={setOpt(i, 'hi')} />
            </div>
          ))}
        </div>
        <div className="qe-grid">
          <label className="field"><span>Explanation (English) — shown to staff with their result</span><textarea rows={4} value={f.explanation} onChange={set('explanation')} /></label>
          <label className="field"><span>Explanation (Hindi)</span><textarea rows={4} value={f.explanationHi} onChange={set('explanationHi')} lang="hi" /></label>
          <label className="field"><span>Topic</span><input value={f.category} onChange={set('category')} /></label>
          <label className="field"><span>Tags (comma separated)</span><input value={f.tags} onChange={set('tags')} /></label>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save question'}</button>
      </div>
    </Modal>
  );
}

/**
 * Read-only view of every question with the answer key and behaviour
 * interpretation (admin only — this data is never sent to participants).
 */
export default function QuestionBank({ sections, dimensions = {}, extraFilter = null, examId = null, onChanged = null }) {
  const [editing, setEditing] = useState(null);
  const [saved, setSaved] = useState('');
  const [lang, setLang] = useState('both');
  const [section, setSection] = useState('all');
  const [search, setSearch] = useState('');
  const [showKey, setShowKey] = useState(true);

  const numbered = useMemo(() => {
    let n = 0;
    return sections.map((s, si) => ({ ...s, no: si + 1, questions: s.questions.map((q) => ({ ...q, no: ++n })) }));
  }, [sections]);

  const term = search.trim().toLowerCase();
  const matches = (q) =>
    (!extraFilter || extraFilter(q)) &&
    (!term ||
    [q.qid, q.category, q.textEn, q.textHi, q.scenarioEn, ...q.options.map((o) => o.en)].some((t) =>
      String(t || '').toLowerCase().includes(term),
    ));
  const show = (en, hi) => (
    <>
      {(lang === 'en' || lang === 'both') && en && <div>{en}</div>}
      {(lang === 'hi' || lang === 'both') && hi && <div lang="hi" className={lang === 'both' ? 'muted' : ''}>{hi}</div>}
    </>
  );
  const total = numbered.reduce((n, s) => n + s.questions.length, 0);

  if (!total) return <p className="muted">This exam has no questions yet. Use Edit or Import to add them.</p>;

  return (
    <div className="stack">
      <div className="card qb-controls">
        <label className="field"><span>Language</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="both">English + Hindi</option>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </label>
        <label className="field"><span>Section</span>
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="all">All sections ({total})</option>
            {numbered.map((s) => <option key={s.no} value={s.no}>Section {s.no} — {s.name} ({s.questions.length})</option>)}
          </select>
        </label>
        <label className="field"><span>Search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Text, category or ID (e.g. K05)" />
        </label>
        <label className="qb-toggle">
          <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
          <span>Show answers &amp; scoring</span>
        </label>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}>Print</button>
      </div>
      <p className="muted small">Admin only. Answers, interpretations and explanations are never shown to participants during the exam.{examId ? ' Use ✎ Edit on a question to change it.' : ''}</p>
      {saved && <div className="alert alert-ok" role="status">{saved}</div>}

      {numbered.every((s) => !s.questions.some(matches)) && <p className="muted">No questions match.</p>}
      {numbered
        .filter((s) => section === 'all' || String(s.no) === String(section))
        .map((s) => {
          const qs = s.questions.filter(matches);
          if (!qs.length) return null;
          return (
            <section key={s.no} className="stack-sm">
              <h2>Section {s.no} — {s.name}{s.nameHi ? ` / ${s.nameHi}` : ''} <span className="muted small">({qs.length})</span></h2>
              {qs.map((q) => {
                const dim = dimensions[q.dimension] || {};
                return (
                  <article key={q.no} className="card qb-card">
                    <div className="qb-head">
                      <strong>Q{q.no}</strong>
                      {q.qid && <span className="badge">{q.qid}</span>}
                      {q.type && <span className="badge">{q.type}</span>}
                      {q.category && <span className="badge">{q.category}</span>}
                      {q.difficulty && <span className="badge">{q.difficulty}</span>}
                      {showKey && q.dimension && <span className="badge badge-in_progress">{dim.label || q.dimension}</span>}
                      {showKey && <span className="badge">weight {q.weight ?? 1}</span>}
                      {examId && (
                        <button type="button" className="btn btn-ghost btn-sm qb-edit" onClick={() => setEditing(q)}>✎ Edit</button>
                      )}
                    </div>
                    {(q.tags || []).length > 0 && (
                      <div className="qb-tags">{q.tags.map((t) => <span key={t} className="tag-chip small">#{t}</span>)}</div>
                    )}
                    {(q.scenarioEn || q.scenarioHi) && (
                      <div className="scenario pre">
                        <span className="scenario-label">Situation</span>
                        {show(q.scenarioEn, q.scenarioHi)}
                      </div>
                    )}
                    <div className="qb-question pre">{show(q.textEn, q.textHi)}</div>
                    <ol className="qb-options">
                      {LETTERS.map((k, i) => {
                        const [kind, label] = optionKind(q, k);
                        const o = q.options[i] || {};
                        return (
                          <li key={k} className={showKey ? `qb-opt qb-${kind}` : 'qb-opt'}>
                            <span className="option-key">{k}</span>
                            <div className="qb-opt-body">
                              {show(o.en, o.hi)}
                              {showKey && label && <div className={`qb-kind kind-${kind === 'best' || kind === 'full' ? 'correct' : kind === 'partial' ? 'acceptable' : kind}`}>{kind === 'best' ? '✓ ' : ''}{label}</div>}
                              {showKey && (q.revealMap || {})[k] && <div className="small muted">Reveals: {q.revealMap[k]}</div>}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                    {showKey && (q.explanation || q.explanationHi) && (
                      <div className="qb-expl small">
                        <strong>Explanation: </strong>
                        {show(q.explanation, q.explanationHi)}
                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          );
        })}
      {editing && (
        <QuestionEditModal
          examId={examId}
          q={editing}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            setSaved(
              r.changed.length
                ? `Q${editing.no}${editing.qid ? ` (${editing.qid})` : ''} saved.${r.submitted && r.changed.some((c) => c.startsWith('correct answer')) ? ` ${r.submitted} person(s) already submitted — their scores were not recalculated.` : ''}`
                : 'No changes.',
            );
            setEditing(null);
            if (onChanged) onChanged();
          }}
        />
      )}
    </div>
  );
}
