import { useEffect, useState } from 'react';
import { useLang } from '../context/LanguageContext.jsx';

/** Live countdown to `target`. `offsetMs` corrects for client/server clock skew. */
export default function Countdown({ target, offsetMs = 0, onDone }) {
  const { t } = useLang();
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  const end = new Date(target).getTime();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offsetMs), 1000);
    return () => clearInterval(id);
  }, [offsetMs]);

  const left = Math.max(0, Math.floor((end - now) / 1000));
  useEffect(() => {
    if (left === 0 && onDone) onDone();
  }, [left, onDone]);

  const parts = [
    [Math.floor(left / 86400), t('days')],
    [Math.floor((left % 86400) / 3600), t('hours')],
    [Math.floor((left % 3600) / 60), t('mins')],
    [left % 60, t('secs')],
  ];
  return (
    <div className="countdown" role="timer" aria-live="off">
      {parts.map(([v, label]) => (
        <div className="countdown-cell" key={label}>
          <span className="countdown-value">{String(v).padStart(2, '0')}</span>
          <span className="countdown-label">{label}</span>
        </div>
      ))}
    </div>
  );
}
