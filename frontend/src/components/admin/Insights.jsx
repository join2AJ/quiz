/**
 * Colour-coded building blocks for the admin analytics views.
 * Colours follow one rule everywhere: green = good (≥70%), amber = watch
 * (50–69%), red = act (<50% or a concern), blue = information, purple = next step.
 */

export const toneOf = (pct) => {
  if (pct === null || pct === undefined || pct === '' || Number.isNaN(Number(pct))) return 'info';
  const n = Number(pct);
  if (n >= 70) return 'good';
  if (n >= 50) return 'warn';
  return 'bad';
};

const TONE_ICON = { good: '✓', warn: '!', bad: '✕', info: 'i', action: '→' };

export const HEADLINE_TONE = {
  'Result unreliable — rushed': 'bad',
  'Needs attention': 'bad',
  'Strong performer': 'good',
  'On track': 'info',
  'Needs development': 'warn',
};

export const ENGAGEMENT = {
  careful: { tone: 'good', label: 'Careful' },
  mixed: { tone: 'warn', label: 'Some too fast' },
  quick: { tone: 'warn', label: 'Very quick' },
  rushed: { tone: 'bad', label: 'Rushed' },
};

/** Response kind → chip label and tone. */
export const KIND_CHIP = {
  correct: { label: 'Correct', tone: 'good' },
  acceptable: { label: 'Partial', tone: 'info' },
  neutral: { label: 'Neutral', tone: 'muted' },
  concern: { label: 'Concern', tone: 'bad' },
  incorrect: { label: 'Wrong', tone: 'bad' },
  unanswered: { label: 'Skipped', tone: 'muted' },
};

export function Chip({ tone = 'info', children, title, strong = false }) {
  return (
    <span className={`chip chip-${tone}${strong ? ' chip-strong' : ''}`} title={title}>
      {children}
    </span>
  );
}

/** A percentage as a coloured pill (heat colour). */
export function PctChip({ value, suffix = '%' }) {
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  return <span className={`pct pct-${toneOf(value)}`}>{value}{suffix}</span>;
}

export function Kpi({ label, value, sub, tone = 'info' }) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

export function KpiRow({ children }) {
  return <div className="kpi-row">{children}</div>;
}

/** One question-and-answer card with a coloured edge and icon. */
export function InsightItem({ q, tone = 'info', children, wide = false }) {
  return (
    <div className={`insight insight-${tone}${wide ? ' insight-wide' : ''}`}>
      <div className="insight-head">
        <span className={`insight-icon icon-${tone}`} aria-hidden="true">{TONE_ICON[tone] || 'i'}</span>
        <span className="insight-q">{q}</span>
      </div>
      <div className="insight-a">{children}</div>
    </div>
  );
}

export function InsightGrid({ children }) {
  return <div className="insight-grid">{children}</div>;
}

export function Legend() {
  return (
    <div className="legend small" aria-label="Colour legend">
      <span><i className="dot dot-good" /> Good (70%+)</span>
      <span><i className="dot dot-warn" /> Watch (50–69%)</span>
      <span><i className="dot dot-bad" /> Act (below 50% or concern)</span>
      <span><i className="dot dot-info" /> Information</span>
    </div>
  );
}

/** Rich rendering of a leadership answer that carries structured data. */
export function AnswerBody({ x }) {
  if (x.list) {
    return (
      <ul className="insight-list">
        {x.list.map((q) => (
          <li key={q.id}>
            <div className="insight-list-head">
              <span className="mono qid">{q.id}</span>
              <span className="insight-list-title">{q.category}</span>
              <PctChip value={q.accuracy} />
            </div>
            {q.best && (
              <div className="small muted">
                Correct answer <b className="answer-letter answer-good">{q.best.letter}</b> {q.best.text}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (x.people && x.people.length) {
    return (
      <ul className="insight-list">
        {x.people.map((p) => (
          <li key={p.username || p.name}>
            <div className="insight-list-head">
              <span className="insight-list-title">{p.name}</span>
            </div>
            <div className="chip-row">
              {p.why.map((w) => <Chip key={w} tone="bad">{w}</Chip>)}
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return <p className="insight-text">{x.a}</p>;
}
