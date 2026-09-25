/** Horizontal meter for a single percentage. `colored` tints it green/amber/red. */
export default function ScoreBar({ label, value, colored = false }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = pct >= 70 ? 'good' : pct >= 50 ? 'warn' : 'bad';
  return (
    <div className={`scorebar${colored ? ` scorebar-${tone}` : ''}`}>
      <div className="scorebar-head">
        <span>{label}</span>
        <strong>{pct}%</strong>
      </div>
      <div className="scorebar-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        <div className="scorebar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
