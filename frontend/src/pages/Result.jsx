import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatDuration } from '../api.js';
import { useLang } from '../context/LanguageContext.jsx';
import TopBar from '../components/TopBar.jsx';
import ScoreGauge from '../components/ScoreGauge.jsx';
import ScoreBar from '../components/ScoreBar.jsx';

export function ResultCard({ exam, result }) {
  const { t, pick, formatDate } = useLang();
  const showSplit = result.knowledgePct !== null && result.behaviourPct !== null;
  return (
    <div className="card result-card">
      <p className="muted">{t('yourResult')}</p>
      <h1>{result.name}</h1>
      <p className="muted">
        {[exam.title, exam.examDate && formatDate(exam.examDate), exam.team, exam.site].filter(Boolean).join(' · ')}
      </p>
      <div className="result-hero">
        <ScoreGauge value={result.totalPct} label={t('totalScore')} />
        <div className="result-hero-text">
          <div className="result-score">{t('scoreOutOf', { correct: result.correct, total: result.total })}</div>
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
        <ScoreBar key={s.no} label={t('sectionLabel', { n: s.no, name: pick(s.name, s.nameHi) })} value={s.pct} />
      ))}
      {showSplit && result.sections.length !== 2 && (
        <>
          <ScoreBar label={t('knowledge')} value={result.knowledgePct} />
          <ScoreBar label={t('behaviour')} value={result.behaviourPct} />
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
        {data && <ResultCard exam={data.exam} result={data.result} />}
        <p>
          <Link className="btn btn-ghost" to="/exams">← {t('backToHome')}</Link>
        </p>
      </main>
    </div>
  );
}
