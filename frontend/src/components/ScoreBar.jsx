/** Horizontal meter for a single percentage. */
export default function ScoreBar({ label, value }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="scorebar">
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
