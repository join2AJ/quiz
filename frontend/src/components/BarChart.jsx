import { useEffect, useRef, useState } from 'react';

/**
 * Single-series vertical bar chart (SVG) with a hover tooltip and a
 * table view toggle. data: [{ label, value, detail? }]
 */
export default function BarChart({ title, data, unit = '', height = 220, max }) {
  const [hover, setHover] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const [boxWidth, setBoxWidth] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);
  const integers = data.every((d) => Number.isInteger(d.value));
  const rawTop = max ?? Math.max(1, ...data.map((d) => d.value));
  // Counts get whole-number ticks; percentages keep their own scale.
  const step = integers && max === undefined ? Math.max(1, Math.ceil(rawTop / 4)) : rawTop / 4;
  const top = integers && max === undefined ? step * 4 : rawTop;
  const width = Math.max(320, data.length * 36, Math.floor(boxWidth));
  const padL = 36;
  const padB = 44;
  const padT = 12;
  const plotH = height - padB - padT;
  const slot = (width - padL) / Math.max(1, data.length);
  const barW = Math.min(28, slot * 0.7);
  const ticks = [0, 1, 2, 3, 4].map((i) => Math.round(step * i * 10) / 10);

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span>{title}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Chart' : 'Table'}
        </button>
      </figcaption>
      {asTable ? (
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Label</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td>
                  {d.value}
                  {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : data.length === 0 ? (
        <p className="muted">No data yet.</p>
      ) : (
        <div className="chart-scroll" ref={boxRef}>
          <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={title}>
            {ticks.map((tk) => {
              const y = padT + plotH - (tk / top) * plotH;
              return (
                <g key={tk}>
                  <line x1={padL} x2={width} y1={y} y2={y} className="chart-grid" />
                  <text x={padL - 6} y={y + 4} textAnchor="end" className="chart-axis">
                    {tk}
                  </text>
                </g>
              );
            })}
            {data.map((d, i) => {
              const h = (d.value / top) * plotH;
              const x = padL + i * slot + (slot - barW) / 2;
              const y = padT + plotH - h;
              const r = Math.min(4, h / 2, barW / 2);
              return (
                <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
                  {h > 0 && (
                    <path
                      className={`chart-bar ${hover === i ? 'hover' : ''}`}
                      d={`M${x},${padT + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${padT + plotH} Z`}
                    />
                  )}
                  <text x={padL + i * slot + slot / 2} y={height - padB + 16} textAnchor="middle" className="chart-axis">
                    {d.short ?? d.label}
                  </text>
                </g>
              );
            })}
            <line x1={padL} x2={width} y1={padT + plotH} y2={padT + plotH} className="chart-baseline" />
          </svg>
          {hover !== null && (
            <div
              className="chart-tip"
              style={{ left: Math.max(0, Math.min(width - 200, padL + hover * slot)), top: 0 }}
              role="status"
            >
              <strong>{data[hover].label}</strong>
              <span>
                {data[hover].value}
                {unit}
              </span>
              {data[hover].detail && <span className="muted">{data[hover].detail}</span>}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
