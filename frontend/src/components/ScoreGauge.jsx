/** Semicircle gauge for a 0–100 percentage. */
export default function ScoreGauge({ value, label }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const r = 80;
  const circumference = Math.PI * r;
  const dash = (pct / 100) * circumference;
  return (
    <figure className="gauge" aria-label={`${label}: ${pct}%`}>
      <svg viewBox="0 0 200 115" role="img" aria-hidden="true">
        <path d="M20 100 A80 80 0 0 1 180 100" className="gauge-track" />
        <path
          d="M20 100 A80 80 0 0 1 180 100"
          className="gauge-fill"
          strokeDasharray={`${dash} ${circumference}`}
        />
        <text x="100" y="92" textAnchor="middle" className="gauge-value">
          {pct}%
        </text>
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
