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
  scenarioEn: '',
  scenarioHi: '',
  options: OPTION_KEYS.map(() => ({ en: '', hi: '' })),
  correct: '',
  fullCredit: [],
  partial: [],
  concern: [],
  neutral: [],
  revealMap: {},
  dimension: '',
  weight: 1,
  difficulty: '',
  tags: [],
  explanation: '',
  explanationHi: '',
});

const DEFAULT_CONFIG = { partialCreditPct: 50, timerSeconds: {}, remarkRules: [], dimensions: {} };

/** How one option scores, for the per-option select. */
function optionKind(q, k) {
  if (q.correct === k) return 'best';
  if ((q.fullCredit || []).includes(k)) return 'full';
  if ((q.partial || []).includes(k)) return 'partial';
  if ((q.concern || []).includes(k)) return 'concern';
  if ((q.neutral || []).includes(k)) return 'neutral';
  return 'wrong';
}

function setOptionKind(q, k, kind) {
  const without = (list) => (list || []).filter((x) => x !== k);
  const next = { ...q, fullCredit: without(q.fullCredit), partial: without(q.partial), concern: without(q.concern), neutral: without(q.neutral) };
  if (kind === 'full') next.fullCredit = [...next.fullCredit, k];
  if (kind === 'partial') next.partial = [...next.partial, k];
  if (kind === 'concern') next.concern = [...next.concern, k];
  if (kind === 'neutral') next.neutral = [...next.neutral, k];
  return next;
}

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
    scenarioEn: pickStr(item.scenarioEn, item.scenario),
    scenarioHi: pickStr(item.scenarioHi),
    fullCredit: item.fullCredit || [],
    partial: item.partial || [],
    concern: item.concern || [],
    neutral: item.neutral || [],
    revealMap: item.revealMap || {},
    dimension: pickStr(item.dimension),
    weight: Number(item.weight) > 0 ? Number(item.weight) : 1,
    explanationHi: pickStr(item.explanationHi),
  };
}

function QuestionEditor({ q, index, group, onChange, onRemove, onMove, isFirst, isLast }) {
  const isBehaviour = q.type === 'BEHAVIOUR' || Object.keys(q.revealMap || {}).length > 0 || (q.concern || []).length > 0;
  const set = (k, v) => onChange({ ...q, [k]: v });
  const setOpt = (i, lang, v) => onChange({ ...q, options: q.options.map((o, j) => (j === i ? { ...o, [lang]: v } : o)) });
  const incomplete = !q.textEn || q.options.some((o) => !o.en) || !OPTION_KEYS.includes(q.correct);
  return (
    <details className={`q-editor ${incomplete ? 'incomplete' : ''}`}>
      <summary>
        <span className="q-editor-no">{index + 1}.</span>
        <span className="truncate">{q.textEn || <em className="muted">New question</em>}</span>
        {q.qid && <span className="badge">{q.qid}</span>}
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
          <label className="field"><span>Scoring dimension</span>
            <input list="dimension-keys" value={q.dimension || ''} onChange={(e) => set('dimension', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} placeholder="e.g. regulatory_knowledge" />
          </label>
          <label className="field"><span>Weight (points)</span>
            <input type="number" min="0.5" step="0.5" value={q.weight ?? 1} onChange={(e) => set('weight', e.target.value)} />
          </label>
        </div>
        <label className="field"><span>Question (English)</span><textarea rows={2} value={q.textEn} onChange={(e) => set('textEn', e.target.value)} /></label>
        <label className="field"><span>Question (Hindi)</span><textarea rows={2} value={q.textHi} onChange={(e) => set('textHi', e.target.value)} /></label>
        <label className="field"><span>Tags (comma-separated — e.g. integrity, customer_satisfaction, prioritisation)</span>
          <input
            list="tag-suggestions"
            value={q.tagsText ?? (q.tags || []).join(', ')}
            onChange={(e) => onChange({ ...q, tagsText: e.target.value, tags: e.target.value.split(',').map((t) => t.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean) })}
            placeholder="integrity, one_team"
          />
        </label>
        <div className="form-grid">
          <label className="field"><span>Situation / scenario (English, optional)</span><textarea rows={2} value={q.scenarioEn || ''} onChange={(e) => set('scenarioEn', e.target.value)} /></label>
          <label className="field"><span>Situation / scenario (Hindi, optional)</span><textarea rows={2} value={q.scenarioHi || ''} onChange={(e) => set('scenarioHi', e.target.value)} /></label>
        </div>
        <div className="options-editor">
          {OPTION_KEYS.map((k, i) => (
            <div key={k} className={`option-editor ${q.correct === k ? 'correct' : ''}`}>
              <label className="correct-pick">
                <input type="radio" name={`correct-${group}-${index}`} checked={q.correct === k} onChange={() => onChange(setOptionKind({ ...q, correct: k }, k, 'best'))} />
                <strong>{k}</strong>
              </label>
              <input value={q.options[i].en} onChange={(e) => setOpt(i, 'en', e.target.value)} placeholder={`Option ${k} (English)`} />
              <input value={q.options[i].hi} onChange={(e) => setOpt(i, 'hi', e.target.value)} placeholder={`Option ${k} (Hindi)`} />
              <select
                aria-label={`Scoring for option ${k}`}
                value={optionKind(q, k)}
                disabled={q.correct === k}
                onChange={(e) => onChange(setOptionKind(q, k, e.target.value))}
              >
                {q.correct === k && <option value="best">Best answer (full)</option>}
                <option value="full">Also full credit</option>
                <option value="partial">Partial credit</option>
                <option value="neutral">Neutral (0)</option>
                <option value="concern">Concern (0, flagged)</option>
                <option value="wrong">Wrong (0)</option>
              </select>
              {isBehaviour && (
                <input
                  className="span-all"
                  value={(q.revealMap || {})[k] || ''}
                  onChange={(e) => set('revealMap', { ...(q.revealMap || {}), [k]: e.target.value })}
                  placeholder={`What choosing ${k} reveals (admin only)`}
                />
              )}
            </div>
          ))}
          <p className="muted small">
            The radio marks the best answer. Use the dropdown to give other options full or partial credit, or mark them as a concern.
            Scoring, interpretations and explanations stay on the server and are never shown to participants.
          </p>
        </div>
        <div className="form-grid">
          <label className="field"><span>Explanation (English, answer key only)</span><textarea rows={2} value={q.explanation} onChange={(e) => set('explanation', e.target.value)} /></label>
          <label className="field"><span>Explanation (Hindi, answer key only)</span><textarea rows={2} value={q.explanationHi || ''} onChange={(e) => set('explanationHi', e.target.value)} /></label>
        </div>
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
      <div className="row-actions">
        <h3 style={{ margin: 0 }}>Questions ({section.questions.length})</h3>
        {section.questions.length > 0 && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => e.currentTarget.closest('fieldset').querySelectorAll('details.q-editor').forEach((d) => { d.open = true; })}>Expand all</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => e.currentTarget.closest('fieldset').querySelectorAll('details.q-editor').forEach((d) => { d.open = false; })}>Collapse all</button>
          </>
        )}
      </div>
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
        config: DEFAULT_CONFIG,
        sections: [emptySection(1), emptySection(2)],
      });
      return;
    }
    api(`/admin/exams/${id}`)
      .then((d) => {
        setForm({
          ...d.exam,
          estimatedMinutes: d.exam.estimatedMinutes ?? '',
          config: { ...DEFAULT_CONFIG, ...(d.exam.config || {}) },
          sections: d.sections.length ? d.sections : [emptySection(1)],
        });
        setStats({ submitted: d.exam.submitted });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (!form) return error ? <div className="alert alert-error">{error}</div> : <p className="muted">Loading…</p>;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setTh = (k) => (e) => setForm((f) => ({ ...f, thresholds: { ...f.thresholds, [k]: e.target.value } }));
  const setCfg = (patch) => setForm((f) => ({ ...f, config: { ...f.config, ...patch } }));
  const rulesList = form.config.remarkRules || [];
  const setRule = (i, k, v) => setCfg({ remarkRules: rulesList.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  const moveRule = (i, d) => {
    const next = [...rulesList];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setCfg({ remarkRules: next });
  };
  const dimensionKeys = [
    ...new Set([
      ...Object.keys(form.config.dimensions || {}),
      ...form.sections.flatMap((sec) => sec.questions.map((q) => q.dimension)).filter(Boolean),
    ]),
  ];
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
      <datalist id="tag-suggestions">
        {[...new Set(form.sections.flatMap((sec) => sec.questions.flatMap((q) => q.tags || [])))].map((t) => <option key={t} value={t} />)}
      </datalist>
      <datalist id="dimension-keys">
        {dimensionKeys.map((k) => <option key={k} value={k} />)}
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
        <legend>Scoring</legend>
        <div className="form-grid form-grid-6">
          <label className="field"><span>Partial credit (% of a question's points)</span>
            <input type="number" min="0" max="100" value={form.config.partialCreditPct ?? 50} onChange={(e) => setCfg({ partialCreditPct: e.target.value })} />
          </label>
          <label className="field"><span>Suggested seconds — Knowledge</span>
            <input type="number" min="0" value={(form.config.timerSeconds || {}).KNOWLEDGE ?? ''} onChange={(e) => setCfg({ timerSeconds: { ...form.config.timerSeconds, KNOWLEDGE: e.target.value } })} placeholder="none" />
          </label>
          <label className="field"><span>Suggested seconds — Behaviour</span>
            <input type="number" min="0" value={(form.config.timerSeconds || {}).BEHAVIOUR ?? ''} onChange={(e) => setCfg({ timerSeconds: { ...form.config.timerSeconds, BEHAVIOUR: e.target.value } })} placeholder="none" />
          </label>
        </div>
        <p className="muted small">
          Each question is worth its weight in points. Partial-credit options earn the percentage above. Suggested seconds are shown to
          participants as a guide (the timer turns orange when exceeded); they do not end the question.
        </p>
      </fieldset>

      <fieldset className="card">
        <legend>Remark rules (checked in order — first match wins)</legend>
        <p className="muted small">
          Variables: <code>total_pct</code>, <code>knowledge_pct</code>, <code>behaviour_pct</code>, <code>section_1_pct</code>…,
          <code> dim_&lt;dimension&gt;_pct</code>. Operators: <code>&gt;= &lt;= &gt; &lt; == != + - * /</code>, <code>and</code>, <code>or</code>, <code>not</code>.
          Example: <code>total_pct &gt;= 70 and knowledge_pct &gt;= behaviour_pct + 20</code>.
          {rulesList.length === 0 && ' No rules set — the threshold-based remarks below are used instead.'}
        </p>
        {rulesList.map((r, i) => (
          <div className="rule-row" key={i}>
            <input value={r.condition} onChange={(e) => setRule(i, 'condition', e.target.value)} placeholder="Condition" aria-label={`Rule ${i + 1} condition`} />
            <textarea rows={2} value={r.en} onChange={(e) => setRule(i, 'en', e.target.value)} placeholder="Remark (English)" aria-label={`Rule ${i + 1} English`} />
            <textarea rows={2} value={r.hi} onChange={(e) => setRule(i, 'hi', e.target.value)} placeholder="Remark (Hindi)" aria-label={`Rule ${i + 1} Hindi`} />
            <div className="row-actions">
              <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveRule(i, -1)} aria-label="Move up">↑</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={i === rulesList.length - 1} onClick={() => moveRule(i, 1)} aria-label="Move down">↓</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setCfg({ remarkRules: rulesList.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          </div>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCfg({ remarkRules: [...rulesList, { condition: '', en: '', hi: '' }] })}>
          + Add rule
        </button>
      </fieldset>

      <fieldset className="card">
        <legend>Remarks thresholds (%) — used when no remark rules are set</legend>
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
