import { useLang } from '../context/LanguageContext.jsx';

export function questionStatus(no, { answers, flags, visited }) {
  if (flags[no]) return 'flagged';
  if (answers[no]) return 'answered';
  if (visited[no]) return 'visited';
  return 'not-visited';
}

export default function QuestionPalette({ questions, sections, current, progress, onJump, open, onClose }) {
  const { t, pick } = useLang();
  return (
    <aside className={`palette ${open ? 'open' : ''}`} aria-label={t('questionPalette')}>
      <div className="palette-head">
        <h3>{t('questionPalette')}</h3>
        <button type="button" className="btn btn-ghost btn-sm palette-close" onClick={onClose}>
          {t('hidePalette')}
        </button>
      </div>
      {sections.map((s) => (
        <div key={s.no} className="palette-section">
          <div className="palette-section-name">{s.name ? t('sectionLabel', { n: s.no, name: pick(s.name, s.nameHi) }) : t('partLabel', { n: s.no })}</div>
          <div className="palette-grid">
            {questions
              .filter((q) => q.sectionNo === s.no)
              .map((q) => (
                <button
                  type="button"
                  key={q.no}
                  className={`pal pal-${questionStatus(q.no, progress)} ${q.no === current ? 'pal-current' : ''}`}
                  onClick={() => onJump(q.no)}
                  aria-label={`${t('question')} ${q.no}`}
                  aria-current={q.no === current ? 'true' : undefined}
                >
                  {q.no}
                </button>
              ))}
          </div>
        </div>
      ))}
      <ul className="legend">
        <li><span className="pal pal-not-visited" /> {t('legendNotVisited')}</li>
        <li><span className="pal pal-visited" /> {t('legendVisited')}</li>
        <li><span className="pal pal-answered" /> {t('legendAnswered')}</li>
        <li><span className="pal pal-flagged" /> {t('legendFlagged')}</li>
      </ul>
    </aside>
  );
}
