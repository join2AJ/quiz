import { useLang } from '../context/LanguageContext.jsx';
import { questionStatus } from '../components/QuestionPalette.jsx';

/** "Which jobs can you do?" — asked once, just before submitting. */
function RolesQuestion({ roleList, roles, onToggleRole, rolesOther, onRolesOther, rolesError }) {
  const { t, pick } = useLang();
  if (!roleList.length) return null;
  return (
    <section className={`roles-card ${rolesError ? 'roles-error' : ''}`}>
      <h2>{t('rolesTitle')}</h2>
      <p className="muted small">{t('rolesHint')}</p>
      <div className="roles-grid">
        {roleList.map((r) => (
          <label key={r.key} className={`role-option ${roles.includes(r.key) ? 'selected' : ''}`}>
            <input type="checkbox" checked={roles.includes(r.key)} onChange={() => onToggleRole(r.key)} />
            <span>{pick(r.en, r.hi)}</span>
          </label>
        ))}
        <label className={`role-option role-none ${roles.includes('none') ? 'selected' : ''}`}>
          <input type="checkbox" checked={roles.includes('none')} onChange={() => onToggleRole('none')} />
          <span>{t('rolesNone')}</span>
        </label>
      </div>
      <label className="field" style={{ marginTop: '0.75rem' }}>
        <span>{t('rolesOther')}</span>
        <input maxLength={300} value={rolesOther} onChange={(e) => onRolesOther(e.target.value)} />
      </label>
      {rolesError && <div className="alert alert-error" role="alert">{t('rolesRequired')}</div>}
    </section>
  );
}

/** Pre-submission summary. Rendered inside the Exam page so state is shared. */
export default function Review({ questions, sections, progress, timed, onJump, onBack, onSubmit, ...rolesProps }) {
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
        {!timed && <div className="stat stat-flagged"><span className="stat-value">{flagged}</span><span className="stat-label">{t('flaggedStatus')}</span></div>}
      </div>
      {timed ? (
        <>
          <p className="muted small">{t('reviewTimed')}</p>
          <div className="table-wrap">
            <table className="table review-table">
              <thead>
                <tr><th>{t('parts')}</th><th className="num">{t('answered')}</th><th className="num">{t('unanswered')}</th></tr>
              </thead>
              <tbody>
                {sections.map((s) => {
                  const qs = questions.filter((q) => q.sectionNo === s.no);
                  const a = qs.filter((q) => progress.answers[q.no]).length;
                  return (
                    <tr key={s.no}>
                      <td>🔒 {s.name ? t('sectionLabel', { n: s.no, name: pick(s.name, s.nameHi) }) : t('partLabel', { n: s.no })}</td>
                      <td className="num">{a}</td>
                      <td className="num">{qs.length - a}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
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
        </>
      )}
      <RolesQuestion {...rolesProps} />
      <div className="question-nav">
        {onBack ? <button type="button" className="btn btn-secondary" onClick={onBack}>← {t('backToExam')}</button> : <span />}
        <button type="button" className="btn btn-primary" onClick={onSubmit}>{t('submitExam')}</button>
      </div>
    </div>
  );
}
