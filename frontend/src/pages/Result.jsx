import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatDuration } from '../api.js';
import { useLang } from '../context/LanguageContext.jsx';
import TopBar from '../components/TopBar.jsx';
import ScoreGauge from '../components/ScoreGauge.jsx';
import ScoreBar from '../components/ScoreBar.jsx';

export function ResultCard({ exam, result }) {
  const { t, pick, formatDate } = useLang();
  return (
    <div className="card result-card">
      <p className="muted">{t('yourResult')}</p>
      <h1>{pick(result.name, result.nameHi)}</h1>
      <p className="muted">
        {[exam.title, exam.examDate && formatDate(exam.examDate), exam.team, exam.site].filter(Boolean).join(' · ')}
      </p>
      <div className="result-hero">
        <ScoreGauge value={result.totalPct} label={t('totalScore')} />
        <div className="result-hero-text">
          <div className="result-score">
            {t('scoreOutOf', { correct: result.correct, total: result.total })}
            {result.total !== result.questionCount && result.questionCount ? <span className="muted small"> {t('points')}</span> : null}
          </div>
          <div className="muted">
            {t('timeTaken')}: <span className="mono">{formatDuration(result.totalSeconds)}</span>
          </div>
          <div className="muted small">
            {t('submittedOn')}: {formatDate(result.submittedAt, true)}
          </div>
        </div>
      </div>
      <h2>{t('sectionScores')}</h2>
      {result.sections.map((s) => (
        <ScoreBar key={s.no} label={`${t('sectionLabel', { n: s.no, name: pick(s.name, s.nameHi) })} · ${s.correct}/${s.total}`} value={s.pct} colored />
      ))}
      {result.dimensions && result.dimensions.length > 0 && (
        <>
          <h2>{t('dimensionScores')}</h2>
          {[
            ['KNOWLEDGE', t('knowledgeAreas')],
            ['BEHAVIOUR', t('behaviourAreas')],
            ['', ''],
          ].map(([group, heading]) => {
            const list = result.dimensions.filter((d) =>
              group ? d.group === group : !['KNOWLEDGE', 'BEHAVIOUR'].includes(d.group),
            );
            if (!list.length) return null;
            return (
              <div key={group || 'other'} className="dimension-group">
                {heading && <h3>{heading}</h3>}
                {list.map((d) => (
                  <ScoreBar key={d.key} label={pick(d.label, d.labelHi)} value={d.pct} colored />
                ))}
              </div>
            );
          })}
        </>
      )}
      <div className="remarks">
        <h2>{t('remarks')}</h2>
        {result.remarks.map((r) => (
          <p key={r.key}>{pick(r.en, r.hi)}</p>
        ))}
      </div>
    </div>
  );
}

const OUTCOME_TONE = { best: 'good', partly: 'info', notBest: 'bad', skipped: 'muted' };
const bandTone = (pct) => (pct >= 70 ? 'good' : pct >= 50 ? 'warn' : 'bad');

/** What the result means, how to improve, every answer and how it was calculated. */
function ResultReport({ result, report }) {
  const { t, pick } = useLang();
  const [filter, setFilter] = useState('notBest');
  const sectionName = (no) => {
    const s = result.sections.find((x) => x.no === no);
    return s ? t('sectionLabel', { n: s.no, name: pick(s.name, s.nameHi) }) : t('partLabel', { n: no });
  };
  const answers = report.answers || [];
  const notBest = answers.filter((a) => a.outcome !== 'best');
  const shown = filter === 'all' ? answers : notBest;
  const calc = report.howCalculated;
  return (
    <>
      <section className="card report-card">
        <div className="report-head">
          <h2>{t('whatItMeans')}</h2>
          <span className={`chip chip-strong chip-${bandTone(result.totalPct)}`}>{t('yourLevel')}: {pick(report.band.en, report.band.hi)}</span>
        </div>
        <p className="report-meaning">{pick(report.meaning.en, report.meaning.hi)}</p>
        {report.strengths.length > 0 && (
          <div className="report-block">
            <h3>{t('youAreStrongIn')}</h3>
            <div className="chip-row">
              {report.strengths.map((a) => (
                <span key={a.key} className="chip chip-good">{pick(a.label, a.labelHi)} · {a.pct}%</span>
              ))}
            </div>
          </div>
        )}
        {report.improve.length > 0 && (
          <div className="report-block">
            <h3>{t('howToImprove')}</h3>
            <ul className="improve-list">
              {report.improve.map((a) => (
                <li key={a.key} className={`improve-${bandTone(a.pct)}`}>
                  <div className="improve-head">
                    <strong>{pick(a.label, a.labelHi)}</strong>
                    <span className={`pct pct-${bandTone(a.pct)}`}>{a.pct}%</span>
                  </div>
                  <p>{pick(a.tip.en, a.tip.hi)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        {report.topics.length > 0 && (
          <div className="report-block">
            <h3>{t('topicsToRevise')}</h3>
            <ul className="topic-list">
              {report.topics.map((x) => (
                <li key={x.topic}>
                  <strong>{x.topic}</strong> <span className="muted small">— {t('seeQuestions', { list: x.questions.join(', ') })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {answers.length > 0 && (
        <section className="card no-print">
          <div className="report-head">
            <h2>{t('everyAnswer')}</h2>
            <div className="segmented" role="group">
              <button type="button" className={filter === 'notBest' ? 'on' : ''} onClick={() => setFilter('notBest')}>{t('onlyNotBest')} ({notBest.length})</button>
              <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{t('showAll')} ({answers.length})</button>
            </div>
          </div>
          <p className="muted small">{t('everyAnswerHint')}</p>
          <div className="stack">
            {[...new Set(shown.map((a) => a.sectionNo))].map((no) => (
              <div key={no} className="answer-group">
                <div className="answer-group-head"><span className="answer-group-title">{sectionName(no)}</span></div>
                <ul className="answer-list">
                  {shown
                    .filter((a) => a.sectionNo === no)
                    .map((a) => {
                      const tone = OUTCOME_TONE[a.outcome];
                      const opt = (k) => a.options.find((o) => o.key === k);
                      const yours = a.yours && opt(a.yours);
                      const best = opt(a.best);
                      return (
                        <li key={a.no} className={`answer-row answer-${tone}`}>
                          <div className="answer-main">
                            <span className="mono qid">{a.qid || `Q${a.no}`}</span>
                            <span className="chip-row answer-meta">
                              <span className={`chip chip-strong chip-${tone}`}>{t(`outcome_${a.outcome}`)}</span>
                              <span className="small muted">{t('pointsShort', { p: a.points, w: a.weight })}</span>
                            </span>
                          </div>
                          {pick(a.scenarioEn, a.scenarioHi) && <div className="answer-question">{pick(a.scenarioEn, a.scenarioHi)}</div>}
                          <div className="answer-qtext">{pick(a.textEn, a.textHi)}</div>
                          <div className="answer-detail">
                            <div className="answer-line">
                              <span className="answer-label">{t('yourAnswer')}</span>
                              {yours ? (
                                <>
                                  <b className={`answer-letter answer-${tone}`}>{a.yours}</b>
                                  <span className="small">{pick(yours.en, yours.hi)}</span>
                                </>
                              ) : (
                                <>
                                  <b className="answer-letter">–</b>
                                  <span className="small muted">{t('notAnswered')}</span>
                                </>
                              )}
                            </div>
                            {a.outcome !== 'best' && best && (
                              <div className="answer-line">
                                <span className="answer-label">{t('bestAnswer')}</span>
                                <b className="answer-letter answer-good">{a.best}</b>
                                <span className="small">
                                  {pick(best.en, best.hi)}
                                  {a.accepted.length > 0 && <span className="muted"> · {t('alsoAccepted')}: {a.accepted.join(', ')}</span>}
                                </span>
                              </div>
                            )}
                            {pick(a.explanationEn, a.explanationHi) && (
                              <div className="small answer-why"><b>{t('explanation')}:</b> {pick(a.explanationEn, a.explanationHi)}</div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card how-card">
        <h2>{t('howCalculated')}</h2>
        <ul className="how-list">
          <li>{t('calcPoints', { q: calc.questions, max: calc.maxPoints })}</li>
          {calc.weighted && <li>{t('calcWeighted')}</li>}
          <li>{t('calcFull')}</li>
          <li>{t('calcPartial', { p: calc.partialCreditPct })}</li>
          <li>{t('calcZero')}</li>
          <li>{t('calcPercent')}</li>
          <li>{t('calcAreas')}</li>
          <li>{t('calcBands', { bands: calc.bands.map((b) => `${pick(b.en, b.hi)} ${b.min}%+`).join(' · ') })}</li>
        </ul>
      </section>
    </>
  );
}

export default function Result() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/result/${id}`)
      .then((d) => {
        if (d.locked) navigate(`/exam/${id}/thank-you`, { replace: true });
        else setData(d);
      })
      .catch(() => setError(t('somethingWrong')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="page">
      <TopBar />
      <main className="container narrow">
        {error && <div className="alert alert-error">{error}</div>}
        {!data && !error && <p className="muted">{t('loading')}</p>}
        {data && (
          <div className="stack result-page">
            <ResultCard exam={data.exam} result={data.result} />
            {data.report && <ResultReport result={data.result} report={data.report} />}
          </div>
        )}
        <p className="row-actions no-print">
          <Link className="btn btn-ghost" to="/exams">← {t('backToHome')}</Link>
          {data && <button type="button" className="btn btn-secondary" onClick={() => window.print()}>🖨 {t('printSummary')}</button>}
        </p>
      </main>
    </div>
  );
}
