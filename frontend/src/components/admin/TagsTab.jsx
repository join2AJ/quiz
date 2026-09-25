import { useMemo, useState } from 'react';
import QuestionBank from './QuestionBank.jsx';

const GROUPS = [
  ['tag', 'Tags'],
  ['dimension', 'Qualities / dimensions'],
  ['category', 'Categories'],
  ['type', 'Question type'],
];

function valuesOf(q, group) {
  if (group === 'tag') return q.tags || [];
  return q[group] ? [q[group]] : [];
}

/**
 * Tag index: every tag, quality (dimension), category and type with the
 * questions mapped to it. Select one or more chips to see only those questions.
 * Tags are edited per question in Edit exam (a question can carry many tags).
 */
export default function TagsTab({ sections, dimensions = {} }) {
  const [selected, setSelected] = useState([]); // [group, value]
  const [mode, setMode] = useState('any');

  const index = useMemo(() => {
    const out = {};
    let n = 0;
    for (const s of sections) {
      for (const q of s.questions) {
        n += 1;
        for (const [group] of GROUPS) {
          for (const v of valuesOf(q, group)) {
            out[group] = out[group] || new Map();
            const list = out[group].get(v) || [];
            list.push(q.qid || `Q${n}`);
            out[group].set(v, list);
          }
        }
      }
    }
    return out;
  }, [sections]);

  const key = (g, v) => `${g}::${v}`;
  const isOn = (g, v) => selected.includes(key(g, v));
  const toggle = (g, v) => setSelected((sel) => (sel.includes(key(g, v)) ? sel.filter((x) => x !== key(g, v)) : [...sel, key(g, v)]));
  const label = (g, v) => (g === 'dimension' ? (dimensions[v] || {}).label || v : g === 'tag' ? `#${v}` : v);

  const filter = selected.length
    ? (q) => {
        const hits = selected.map((k) => {
          const [g, v] = k.split('::');
          return valuesOf(q, g).includes(v);
        });
        return mode === 'all' ? hits.every(Boolean) : hits.some(Boolean);
      }
    : () => false;

  const hasTags = index.tag && index.tag.size > 0;

  return (
    <div className="stack">
      <div className="card stack">
        <p className="muted small">
          Each question can be mapped to several tags, one quality (dimension) and one category. Click chips to show the
          matching questions below. {!hasTags && 'No tags yet — add them per question in Edit exam (comma-separated).'}
          {' '}To change a question's tags, use <b>Edit</b> → open the question → <b>Tags</b>.
        </p>
        {GROUPS.map(([g, title]) =>
          index[g] && index[g].size ? (
            <details key={g} open={g !== 'category'}>
              <summary><h3 style={{ display: 'inline' }}>{title} <span className="muted small">({index[g].size})</span></h3></summary>
              <div className="chip-row" style={{ marginTop: '0.5rem' }}>
                {[...index[g].entries()]
                  .sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])))
                  .map(([v, ids]) => (
                    <button
                      type="button"
                      key={v}
                      className={`tag-chip ${isOn(g, v) ? 'on' : ''}`}
                      aria-pressed={isOn(g, v)}
                      onClick={() => toggle(g, v)}
                      title={ids.join(', ')}
                    >
                      {label(g, v)} <span className="tag-count">{ids.length}</span>
                    </button>
                  ))}
              </div>
            </details>
          ) : null,
        )}
        {selected.length > 0 && (
          <div className="row-actions">
            <span className="small">Showing questions matching</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Match mode">
              <option value="any">any selected chip</option>
              <option value="all">all selected chips</option>
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>Clear</button>
          </div>
        )}
      </div>
      {selected.length === 0 ? (
        <p className="muted">Select a tag, quality or category above to see its questions.</p>
      ) : (
        <QuestionBank sections={sections} dimensions={dimensions} extraFilter={filter} />
      )}
    </div>
  );
}
