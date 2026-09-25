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

export default function App() {
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
