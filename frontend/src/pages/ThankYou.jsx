import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { formatDateIn, translateIn, useLang } from '../context/LanguageContext.jsx';
import TopBar from '../components/TopBar.jsx';
import Countdown from '../components/Countdown.jsx';

export default function ThankYou() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, pick } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api(`/result/${id}`)
      .then((d) => {
        if (!d.locked) navigate(`/exam/${id}/result`, { replace: true });
        else setData(d);
      })
      .catch(() => setError(t('somethingWrong')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const onDone = useCallback(() => setReady(true), []);

  if (error) {
    return (
      <div className="page"><TopBar /><main className="container narrow"><div className="alert alert-error">{error}</div></main></div>
    );
  }
  if (!data) return <div className="center-page muted">{t('loading')}</div>;

  const unlockAt = data.attempt.unlockAt;
  const offset = new Date(data.serverTime).getTime() - Date.now();

  return (
    <div className="page thankyou-page">
      <TopBar />
      <main className="thankyou">
        <div className="thankyou-inner">
          <p className="thankyou-name">{pick(data.name, data.nameHi)}</p>
          <h1>{t('thankYouTitle')}</h1>
          <div className="thankyou-sub">
            <p lang="en">{translateIn('en', 'resultAvailableOn', { date: formatDateIn('en', unlockAt) })}</p>
            <p lang="hi">{translateIn('hi', 'resultAvailableOn', { date: formatDateIn('hi', unlockAt) })}</p>
          </div>
          <p className="muted">{data.exam.title}</p>
          {ready ? (
            <div>
              <p>{t('resultReadyNow')}</p>
              <Link className="btn btn-primary" to={`/exam/${id}/result`}>{t('viewResult')}</Link>
            </div>
          ) : (
            <>
              <p className="countdown-title">{t('resultUnlocksIn')}</p>
              <Countdown target={unlockAt} offsetMs={offset} onDone={onDone} />
            </>
          )}
          <Link className="btn btn-ghost" to="/exams">{t('backToHome')}</Link>
        </div>
      </main>
    </div>
  );
}
