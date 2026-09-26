import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { useLang } from './context/LanguageContext.jsx';
import Login from './pages/Login.jsx';
import ParticipantHome from './pages/ParticipantHome.jsx';
import Exam from './pages/Exam.jsx';
import ThankYou from './pages/ThankYou.jsx';
import Result from './pages/Result.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';

function Loading() {
  const { t } = useLang();
  return <div className="center-page muted">{t('loading')}</div>;
}

function RequireRole({ role, children }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return children;
}

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/exams'} replace />;
}

/**
 * Staff pages: no right-click menu, copying, pasting, text selection or print
 * shortcut (typing in form fields still works). Admin pages are not affected.
 */
function useCopyGuard(active) {
  useEffect(() => {
    if (!active) return undefined;
    const inField = (e) => !!(e.target && e.target.closest && e.target.closest('input, textarea, select'));
    const block = (e) => {
      if (!inField(e)) e.preventDefault();
    };
    const blockAlways = (e) => e.preventDefault();
    const keys = (e) => {
      const k = String(e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && ['p', 's', 'u'].includes(k)) e.preventDefault();
      else if (mod && ['c', 'x', 'v', 'a'].includes(k) && !inField(e)) e.preventDefault();
      else if (k === 'f12' || (mod && e.shiftKey && ['i', 'j', 'c'].includes(k))) e.preventDefault();
    };
    const listeners = [
      ['contextmenu', blockAlways],
      ['copy', block],
      ['cut', block],
      ['paste', block],
      ['selectstart', block],
      ['dragstart', blockAlways],
      ['keydown', keys],
    ];
    listeners.forEach(([ev, fn]) => document.addEventListener(ev, fn));
    document.body.classList.add('no-copy');
    return () => {
      listeners.forEach(([ev, fn]) => document.removeEventListener(ev, fn));
      document.body.classList.remove('no-copy');
    };
  }, [active]);
}

export default function App() {
  const { user, ready } = useAuth();
  useCopyGuard(ready && !(user && user.role === 'admin'));
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/exams" element={<RequireRole role="participant"><ParticipantHome /></RequireRole>} />
      <Route path="/exam/:id" element={<RequireRole role="participant"><Exam /></RequireRole>} />
      <Route path="/exam/:id/thank-you" element={<RequireRole role="participant"><ThankYou /></RequireRole>} />
      <Route path="/exam/:id/result" element={<RequireRole role="participant"><Result /></RequireRole>} />
      <Route path="/admin/*" element={<RequireRole role="admin"><AdminDashboard /></RequireRole>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
