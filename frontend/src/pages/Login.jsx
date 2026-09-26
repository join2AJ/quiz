import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import LanguageToggle from '../components/LanguageToggle.jsx';
import Logo from '../components/Logo.jsx';
import Modal from '../components/Modal.jsx';

export default function Login() {
  const { user, ready, login } = useAuth();
  const { t, formatDate } = useLang();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [replaced, setReplaced] = useState(() => {
    try {
      const v = sessionStorage.getItem('psq_replaced') === '1';
      sessionStorage.removeItem('psq_replaced');
      return v;
    } catch {
      return false;
    }
  });

  async function routeFor(u) {
    if (u.role === 'admin') return '/admin';
    // A participant with exactly one assessment goes straight to it.
    try {
      const { exams } = await api('/exam/mine');
      if (exams.length === 1) return `/exam/${exams[0].id}`;
    } catch {
      /* fall through to the list */
    }
    return '/exams';
  }

  useEffect(() => {
    if (ready && user) routeFor(user).then((to) => navigate(to, { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function signIn(force) {
    setError('');
    setReplaced(false);
    setBusy(true);
    try {
      const u = await login(username, password, force);
      setConflict(null);
      navigate(await routeFor(u), { replace: true });
    } catch (err) {
      if (err.status === 409 && err.code === 'ALREADY_LOGGED_IN') setConflict(err.data);
      else if (err.status === 429) setError(t('tooManyAttempts'));
      else if (err.status === 401 || err.status === 400) setError(t('invalidCredentials'));
      else setError(t('serverUnavailable')); // network error, 404 (no API behind this site) or 5xx
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    signIn(false);
  }

  return (
    <div className="login-page">
      <div className="login-lang">
        <LanguageToggle />
      </div>
      <form className="card login-card" onSubmit={onSubmit} noValidate>
        <div className="login-logo">
          <Logo size={80} />
        </div>
        <h1>{t('welcome')}</h1>
        <p className="muted">{t('loginSubtitle')}</p>
        <label className="field">
          <span>{t('username')}</span>
          <input
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>{t('password')}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {replaced && <div className="alert alert-warn" role="alert">{t('replacedMessage')}</div>}
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy || !username || !password}>
          {busy ? t('signingIn') : t('signIn')}
        </button>
      </form>
      {conflict && (
        <Modal title={t('alreadyLoggedInTitle')} onClose={() => setConflict(null)}>
          <p>{t('alreadyLoggedInText', { device: conflict.device || '—', time: conflict.since ? formatDate(conflict.since, true) : '—' })}</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setConflict(null)} disabled={busy}>{t('cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={() => signIn(true)} disabled={busy}>{t('loginHereInstead')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
