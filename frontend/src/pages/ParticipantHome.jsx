import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import TopBar from '../components/TopBar.jsx';

export default function ParticipantHome() {
  const { user } = useAuth();
  const { t, formatDate, pick } = useLang();
  const [exams, setExams] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/exam/mine')
      .then((d) => setExams(d.exams))
      .catch(() => setError(t('somethingWrong')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function action(e) {
    const a = e.attempt;
    if (a.status === 'submitted') {
      return a.unlocked ? (
        <Link className="btn btn-primary" to={`/exam/${e.id}/result`}>{t('viewResult')}</Link>
      ) : (
        <Link className="btn btn-secondary" to={`/exam/${e.id}/thank-you`}>{t('resultPending')}</Link>
      );
    }
    if (a.status === 'in_progress') return <Link className="btn btn-primary" to={`/exam/${e.id}`}>{t('continue')}</Link>;
    if (e.status !== 'Active') return <span className="badge">{t('examClosed')}</span>;
    return <Link className="btn btn-primary" to={`/exam/${e.id}`}>{t('start')}</Link>;
  }

  function statusLabel(a) {
    if (a.status === 'submitted') return a.unlocked ? t('statusResultReady') : t('statusSubmitted');
    if (a.status === 'in_progress') return t('statusInProgress');
    return t('statusNotStarted');
  }

  return (
    <div className="page">
      <TopBar />
      <main className="container">
        <h1>{t('myExams')}</h1>
        <p className="muted">{pick(user.name, user.nameHi)}</p>
        {error && <div className="alert alert-error">{error}</div>}
        {!exams && !error && <p className="muted">{t('loading')}</p>}
        {exams && exams.length === 0 && <div className="card">{t('noExams')}</div>}
        <div className="exam-list">
          {exams &&
            exams.map((e) => (
              <div className="card exam-card" key={e.id}>
                <div>
                  <h2>{e.title}</h2>
                  <p className="muted">
                    {[e.team, e.site, e.examDate && formatDate(e.examDate)].filter(Boolean).join(' · ')}
                  </p>
                  <span className={`badge badge-${e.attempt.status}`}>{statusLabel(e.attempt)}</span>
                </div>
                <div>{action(e)}</div>
              </div>
            ))}
        </div>
      </main>
    </div>
  );
}
