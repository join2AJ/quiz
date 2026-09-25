import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';

const OPTION_KEYS = ['A', 'B', 'C', 'D'];

const DEFAULT_THRESHOLDS = { excellent: 85, good: 70, fair: 50, knowledge: 70, behaviour: 70, gap: 20 };

const emptyQuestion = (type = '') => ({
  type,
  category: '',
  textEn: '',
  textHi: '',
  options: OPTION_KEYS.map(() => ({ en: '', hi: '' })),
  correct: '',
  explanation: '',
});

const emptySection = (n) => ({
  name: n === 1 ? 'Knowledge' : n === 2 ? 'Behaviour' : '',
  nameHi: n === 1 ? 'ज्ञान' : n === 2 ? 'व्यवहार' : '',
  description: '',
  descriptionHi: '',
  questions: [],
});

const SAMPLE_JSON = `[
  {
    "type": "KNOWLEDGE",
    "category": "TAEP Fundamentals",
    "textEn": "What does TAEP stand for?",
    "textHi": "TAEP का पूरा नाम क्या है?",
    "options": [
      { "en": "Option A", "hi": "विकल्प A" },
      { "en": "Option B", "hi": "विकल्प B" },
      { "en": "Option C", "hi": "विकल्प C" },
      { "en": "Option D", "hi": "विकल्प D" }
    ],
    "correct": "B",
    "explanation": "Optional note shown only in the Answer Key sheet"
  }
]`;

/** Accept a few common shapes for pasted question JSON. */
function normalizeImported(item, defaultType) {
  const pickStr = (...vals) => {
    const v = vals.find((x) => x !== undefined && x !== null && x !== '');
    return v === undefined ? '' : String(v);
  };
  let options = OPTION_KEYS.map(() => ({ en: '', hi: '' }));
  if (Array.isArray(item.options)) {
    options = OPTION_KEYS.map((_, i) => {
      const o = item.options[i];
      if (typeof o === 'string') return { en: o, hi: (item.optionsHi || [])[i] || '' };
      return { en: pickStr(o && (o.en ?? o.textEn)), hi: pickStr(o && (o.hi ?? o.textHi)) };
    });
  } else if (item.options && typeof item.options === 'object') {
    options = OPTION_KEYS.map((k) => {
      const o = item.options[k] ?? item.options[k.toLowerCase()];
      if (typeof o === 'string') return { en: o, hi: '' };
      return { en: pickStr(o && o.en), hi: pickStr(o && o.hi) };
    });
  } else if (Array.isArray(item.optionsEn)) {
    options = OPTION_KEYS.map((_, i) => ({ en: pickStr(item.optionsEn[i]), hi: pickStr((item.optionsHi || [])[i]) }));
  }
  return {
    type: pickStr(item.type, item.tag, defaultType).toUpperCase(),
    category: pickStr(item.category),
    textEn: pickStr(item.textEn, item.questionEn, item.question, item.text),
    textHi: pickStr(item.textHi, item.questionHi),
    options,
    correct: pickStr(item.correct, item.answer, item.correctOption).trim().toUpperCase().slice(0, 1),
    explanation: pickStr(item.explanation),
  };
}

function QuestionEditor({ q, index, group, onChange, onRemove, onMove, isFirst, isLast }) {
  const set = (k, v) => onChange({ ...q, [k]: v });
  const setOpt = (i, lang, v) => onChange({ ...q, options: q.options.map((o, j) => (j === i ? { ...o, [lang]: v } : o)) });
  const incomplete = !q.textEn || q.options.some((o) => !o.en) || !OPTION_KEYS.includes(q.correct);
  return (
    <details className={`q-editor ${incomplete ? 'incomplete' : ''}`}>
      <summary>
        <span className="q-editor-no">{index + 1}.</span>
        <span className="truncate">{q.textEn || <em className="muted">New question</em>}</span>
        {q.type && <span className="badge">{q.type}</span>}
        {q.correct && <span className="badge badge-ok">Ans {q.correct}</span>}
        {incomplete && <span className="badge badge-warn">incomplete</span>}
      </summary>
      <div className="q-editor-body">
        <div className="form-grid">
          <label className="field"><span>Question type tag</span>
            <input list="type-tags" value={q.type} onChange={(e) => set('type', e.target.value.toUpperCase())} placeholder="KNOWLEDGE / BEHAVIOUR" />
          </label>
          <label className="field"><span>Category label</span>
            <input value={q.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. TAEP Fundamentals" />
          </label>
        </div>
        <label className="field"><span>Question (English)</span><textarea rows={2} value={q.textEn} onChange={(e) => set('textEn', e.target.value)} /></label>
        <label className="field"><span>Question (Hindi)</span><textarea rows={2} value={q.textHi} onChange={(e) => set('textHi', e.target.value)} /></label>
        <div className="options-editor">
          {OPTION_KEYS.map((k, i) => (
            <div key={k} className={`option-editor ${q.correct === k ? 'correct' : ''}`}>
              <label className="correct-pick">
                <input type="radio" name={`correct-${group}-${index}`} checked={q.correct === k} onChange={() => set('correct', k)} />
                <strong>{k}</strong>
              </label>
              <input value={q.options[i].en} onChange={(e) => setOpt(i, 'en', e.target.value)} placeholder={`Option ${k} (English)`} />
              <input value={q.options[i].hi} onChange={(e) => setOpt(i, 'hi', e.target.value)} placeholder={`Option ${k} (Hindi)`} />
            </div>
          ))}
          <p className="muted small">Select the radio button next to the correct option. The answer key stays on the server.</p>
        </div>
        <label className="field"><span>Explanation (answer key sheet only)</span><input value={q.explanation} onChange={(e) => set('explanation', e.target.value)} /></label>
        <div className="row-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={isFirst} onClick={() => onMove(-1)}>↑ Move up</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={isLast} onClick={() => onMove(1)}>↓ Move down</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>Delete question</button>
        </div>
      </div>
    </details>
  );
}

function SectionEditor({ section, index, onChange, onRemove, canRemove }) {
  const [bulk, setBulk] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMsg, setBulkMsg] = useState(null);
  const set = (k, v) => onChange({ ...section, [k]: v });
  const defaultType = index === 0 ? 'KNOWLEDGE' : index === 1 ? 'BEHAVIOUR' : '';

  function updateQ(i, q) {
    set('questions', section.questions.map((x, j) => (j === i ? q : x)));
  }
  function moveQ(i, d) {
    const qs = [...section.questions];
    [qs[i], qs[i + d]] = [qs[i + d], qs[i]];
    set('questions', qs);
  }
  function importBulk() {
    try {
      let parsed = JSON.parse(bulk);
      if (!Array.isArray(parsed)) parsed = parsed.questions || [parsed];
      const qs = parsed.map((item) => normalizeImported(item, defaultType));
      set('questions', [...section.questions, ...qs]);
      setBulkMsg({ ok: true, text: `Imported ${qs.length} question(s).` });
      setBulk('');
    } catch (e) {
      setBulkMsg({ ok: false, text: `Invalid JSON: ${e.message}` });
    }
  }

  return (
    <fieldset className="card section-editor">
      <legend>Section {index + 1}</legend>
      <div className="form-grid">
        <label className="field"><span>Section name (English)</span><input value={section.name} onChange={(e) => set('name', e.target.value)} required /></label>
        <label className="field"><span>Section name (Hindi)</span><input value={section.nameHi} onChange={(e) => set('nameHi', e.target.value)} /></label>
        <label className="field"><span>Description (English)</span><textarea rows={2} value={section.description} onChange={(e) => set('description', e.target.value)} /></label>
        <label className="field"><span>Description (Hindi)</span><textarea rows={2} value={section.descriptionHi} onChange={(e) => set('descriptionHi', e.target.value)} /></label>
      </div>
      <h3>Questions ({section.questions.length})</h3>
      <div className="stack-sm">
        {section.questions.map((q, i) => (
          <QuestionEditor
            key={i}
            q={q}
            index={i}
            group={index}
            onChange={(nq) => updateQ(i, nq)}
            onRemove={() => set('questions', section.questions.filter((_, j) => j !== i))}
            onMove={(d) => moveQ(i, d)}
            isFirst={i === 0}
            isLast={i === section.questions.length - 1}
          />
        ))}
      </div>
      <div className="row-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => set('questions', [...section.questions, emptyQuestion(defaultType)])}>
          + Add question
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBulkOpen((v) => !v)}>
          {bulkOpen ? 'Hide bulk import' : 'Bulk import (JSON)'}
        </button>
        {canRemove && (
          <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>Remove section</button>
        )}
      </div>
      {bulkOpen && (
        <div className="stack">
          <p className="muted small">Paste a JSON array of questions. They are appended to this section. Example:</p>
          <pre className="code">{SAMPLE_JSON}</pre>
          <textarea rows={8} className="mono" value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="[ { ... }, { ... } ]" />
          <div><button type="button" className="btn btn-primary btn-sm" onClick={importBulk} disabled={!bulk.trim()}>Import questions</button></div>
          {bulkMsg && <div className={`alert ${bulkMsg.ok ? 'alert-ok' : 'alert-error'}`}>{bulkMsg.text}</div>}
        </div>
      )}
    </fieldset>
  );
}

export default function ExamEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) {
      setForm({
        title: '',
        team: '',
        site: '',
        examDate: new Date().toISOString().slice(0, 10),
        instructions: '',
        instructionsHi: '',
        unlockDays: 10,
        estimatedMinutes: '',
        status: 'Active',
        thresholds: DEFAULT_THRESHOLDS,
        sections: [emptySection(1), emptySection(2)],
      });
      return;
    }
    api(`/admin/exams/${id}`)
      .then((d) => {
        setForm({ ...d.exam, estimatedMinutes: d.exam.estimatedMinutes ?? '', sections: d.sections.length ? d.sections : [emptySection(1)] });
        setStats({ submitted: d.exam.submitted });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (!form) return error ? <div className="alert alert-error">{error}</div> : <p className="muted">Loading…</p>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setTh = (k) => (e) => setForm((f) => ({ ...f, thresholds: { ...f.thresholds, [k]: e.target.value } }));
  const totalQ = form.sections.reduce((n, s) => n + s.questions.length, 0);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...form };
      if (id) {
        await api(`/admin/exams/${id}`, { method: 'PUT', body });
        navigate(`/admin/exams/${id}`);
      } else {
        const d = await api('/admin/exams', { method: 'POST', body });
        navigate(`/admin/exams/${d.exam.id}`);
      }
    } catch (err) {
      setError(err.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="stack">
      <datalist id="type-tags">
        <option value="KNOWLEDGE" />
        <option value="BEHAVIOUR" />
      </datalist>
      <div className="page-head">
        <h1>{id ? 'Edit exam' : 'Create new exam'}</h1>
        <div className="row-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save exam'}</button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {stats && stats.submitted > 0 && (
        <div className="alert alert-warn">
          {stats.submitted} participant(s) have already submitted. Editing questions or the answer key will not re-score existing submissions.
        </div>
      )}

      <fieldset className="card">
        <legend>Exam details</legend>
        <div className="form-grid">
          <label className="field span-2"><span>Exam title</span><input value={form.title} onChange={set('title')} placeholder="Pass Section Knowledge & Behaviour Assessment 2026" required /></label>
          <label className="field"><span>Team name</span><input value={form.team} onChange={set('team')} placeholder="Pass Section — LBIA" /></label>
          <label className="field"><span>Site / Location</span><input value={form.site} onChange={set('site')} placeholder="Lucknow International Airport" /></label>
          <label className="field"><span>Exam date</span><input type="date" value={form.examDate} onChange={set('examDate')} /></label>
          <label className="field"><span>Status</span>
            <select value={form.status} onChange={set('status')}>
              <option>Active</option>
              <option>Closed</option>
              <option>Results Released</option>
            </select>
          </label>
          <label className="field"><span>Result unlock delay (days after submission)</span><input type="number" min="0" value={form.unlockDays} onChange={set('unlockDays')} /></label>
          <label className="field"><span>Estimated time (minutes)</span><input type="number" min="1" value={form.estimatedMinutes} onChange={set('estimatedMinutes')} placeholder={`default: ${totalQ || 'number of questions'}`} /></label>
          <label className="field span-2"><span>Instructions (English)</span><textarea rows={4} value={form.instructions} onChange={set('instructions')} /></label>
          <label className="field span-2"><span>Instructions (Hindi)</span><textarea rows={4} value={form.instructionsHi} onChange={set('instructionsHi')} /></label>
        </div>
      </fieldset>

      <fieldset className="card">
        <legend>Remarks thresholds (%)</legend>
        <p className="muted small">
          Total ≥ <b>Outstanding</b> → “You nailed it!”. Total ≥ <b>Good</b> → strength remark using the Knowledge / Behaviour thresholds.
          Total ≥ <b>Fair</b> → “Good effort”. Below Fair → growth remark. A Knowledge/Behaviour difference ≥ <b>Gap</b> adds a focus-area remark.
          Knowledge/Behaviour scores come from the question type tag.
        </p>
        <div className="form-grid form-grid-6">
          <label className="field"><span>Outstanding</span><input type="number" value={form.thresholds.excellent} onChange={setTh('excellent')} /></label>
          <label className="field"><span>Good</span><input type="number" value={form.thresholds.good} onChange={setTh('good')} /></label>
          <label className="field"><span>Fair</span><input type="number" value={form.thresholds.fair} onChange={setTh('fair')} /></label>
          <label className="field"><span>Knowledge</span><input type="number" value={form.thresholds.knowledge} onChange={setTh('knowledge')} /></label>
          <label className="field"><span>Behaviour</span><input type="number" value={form.thresholds.behaviour} onChange={setTh('behaviour')} /></label>
          <label className="field"><span>Gap</span><input type="number" value={form.thresholds.gap} onChange={setTh('gap')} /></label>
        </div>
      </fieldset>

      {form.sections.map((s, i) => (
        <SectionEditor
          key={i}
          section={s}
          index={i}
          canRemove={form.sections.length > 1}
          onChange={(ns) => setForm((f) => ({ ...f, sections: f.sections.map((x, j) => (j === i ? ns : x)) }))}
          onRemove={() => setForm((f) => ({ ...f, sections: f.sections.filter((_, j) => j !== i) }))}
        />
      ))}
      <div className="row-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setForm((f) => ({ ...f, sections: [...f.sections, emptySection(f.sections.length + 1)] }))}>
          + Add section
        </button>
        <span className="muted">Total questions: {totalQ}</span>
      </div>
      <div className="page-foot">
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Saving…' : 'Save exam'}</button>
      </div>
    </form>
  );
}
