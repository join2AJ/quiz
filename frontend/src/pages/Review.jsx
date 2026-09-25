import { useLang } from '../context/LanguageContext.jsx';
import { questionStatus } from '../components/QuestionPalette.jsx';

/** Pre-submission summary. Rendered inside the Exam page so state is shared. */
export default function Review({ questions, progress, onJump, onBack, onSubmit }) {
  const { t, pick } = useLang();
  const answered = questions.filter((q) => progress.answers[q.no]).length;
  const flagged = questions.filter((q) => progress.flags[q.no]).length;
  const unanswered = questions.length - answered;

  return (
    <div className="card">
      <h1>{t('reviewTitle')}</h1>
      <div className="stat-row">
        <div className="stat stat-answered"><span className="stat-value">{answered}</span><span className="stat-label">{t('answered')}</span></div>
        <div className="stat stat-unanswered"><span className="stat-value">{unanswered}</span><span className="stat-label">{t('unanswered')}</span></div>
        <div className="stat stat-flagged"><span className="stat-value">{flagged}</span><span className="stat-label">{t('flaggedStatus')}</span></div>
      </div>
      {unanswered > 0 && <div className="alert alert-warn">{t('unansweredWarning', { n: unanswered })}</div>}
      <p className="muted small">{t('reviewHint')}</p>
      <div className="table-wrap">
        <table className="table review-table">
          <thead>
            <tr>
              <th>{t('question')}</th>
              <th>{t('status')}</th>
              <th className="hide-sm" />
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => {
              const st = questionStatus(q.no, progress);
              const isAnswered = !!progress.answers[q.no];
              return (
                <tr key={q.no} className="clickable" onClick={() => onJump(q.no)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onJump(q.no)}>
                  <td>
                    <span className={`pal pal-${st}`}>{q.no}</span>
                  </td>
                  <td>
                    {isAnswered ? t('answered') : t('unanswered')}
                    {progress.flags[q.no] && <span className="badge badge-flag">⚑ {t('flaggedStatus')}</span>}
                  </td>
                  <td className="muted small truncate hide-sm">{pick(q.textEn, q.textHi)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="question-nav">
        <button type="button" className="btn btn-secondary" onClick={onBack}>← {t('backToExam')}</button>
        <button type="button" className="btn btn-primary" onClick={onSubmit}>{t('submitExam')}</button>
      </div>
    </div>
  );
}
