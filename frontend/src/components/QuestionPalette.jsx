import { useLang } from '../context/LanguageContext.jsx';

export function questionStatus(no, { answers, flags, visited }) {
  if (flags[no]) return 'flagged';
  if (answers[no]) return 'answered';
  if (visited[no]) return 'visited';
  return 'not-visited';
}

export default function QuestionPalette({ questions, sections, current, progress, onJump, open, onClose, clock }) {
  const { t, pick } = useLang();
  return (
    <aside className={`palette ${open ? 'open' : ''}`} aria-label={t('questionPalette')}>
      <div className="palette-head">
        <h3>{t('questionPalette')}</h3>
        <button type="button" className="btn btn-ghost btn-sm palette-close" onClick={onClose}>
          {t('hidePalette')}
        </button>
      </div>
      {sections.map((s) => {
        // With time limits only the open part can be used.
        const state = !clock ? 'open' : clock.phase === 'section' && clock.current === s.no ? 'open' : (clock.closed || []).includes(s.no) ? 'closed' : 'later';
        return (
        <div key={s.no} className={`palette-section palette-${state}`}>
          <div className="palette-section-name">
            {s.name ? t('sectionLabel', { n: s.no, name: pick(s.name, s.nameHi) }) : t('partLabel', { n: s.no })}
            {clock && <span className={`part-state part-${state}`}>{state === 'open' ? t('partNow') : state === 'closed' ? `🔒 ${t('partClosed')}` : t('partLocked')}</span>}
          </div>
          <div className="palette-grid">
            {questions
              .filter((q) => q.sectionNo === s.no)
              .map((q) => (
                <button
                  type="button"
                  key={q.no}
                  className={`pal pal-${questionStatus(q.no, progress)} ${q.no === current ? 'pal-current' : ''}`}
                  onClick={() => onJump(q.no)}
                  disabled={state !== 'open'}
                  aria-label={`${t('question')} ${q.no}`}
                  aria-current={q.no === current ? 'true' : undefined}
                >
                  {q.no}
                </button>
              ))}
          </div>
        </div>
        );
      })}
      <ul className="legend">
        <li><span className="pal pal-not-visited" /> {t('legendNotVisited')}</li>
        <li><span className="pal pal-visited" /> {t('legendVisited')}</li>
        <li><span className="pal pal-answered" /> {t('legendAnswered')}</li>
        <li><span className="pal pal-flagged" /> {t('legendFlagged')}</li>
      </ul>
    </aside>
  );
}
