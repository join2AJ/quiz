import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../context/LanguageContext.jsx';
import TopBar from '../components/TopBar.jsx';
import ExamList from '../components/admin/ExamList.jsx';
import ExamEditor from '../components/admin/ExamEditor.jsx';
import ExamDetail from '../components/admin/ExamDetail.jsx';
import ParticipantsAdmin from '../components/admin/ParticipantsAdmin.jsx';
import SettingsAdmin from '../components/admin/SettingsAdmin.jsx';
import ImportAdmin from '../components/admin/ImportAdmin.jsx';
import AuditAdmin from '../components/admin/AuditAdmin.jsx';

/** Admin panel — English only. */
/** Shows the server's configuration problem (e.g. a wrong Supabase key) to the admin. */
function HealthBanner() {
  const [problem, setProblem] = useState(null);
  useEffect(() => {
    fetch('/api/health', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setProblem(d.ok ? null : d.error || 'The server is not configured correctly.'))
      .catch(() => setProblem('Cannot reach the server.'));
  }, []);
  if (!problem) return null;
  return (
    <div className="container wide" style={{ paddingBottom: 0 }}>
      <div className="alert alert-error" role="alert">
        <strong>Setup problem:</strong> {problem}
        <div className="small">After changing environment variables in Netlify, trigger a new deploy.</div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <LanguageProvider forceLang="en">
      <div className="page admin">
        <TopBar showLang={false}>
          <span className="badge">Admin</span>
        </TopBar>
        <nav className="admin-nav">
          <NavLink to="/admin" end>Exams</NavLink>
          <NavLink to="/admin/participants">Participants</NavLink>
          <NavLink to="/admin/import">Import</NavLink>
          <NavLink to="/admin/audit">Audit log</NavLink>
          <NavLink to="/admin/settings">Settings</NavLink>
        </nav>
        <HealthBanner />
        <main className="container wide">
          <Routes>
            <Route index element={<ExamList />} />
            <Route path="exams/new" element={<ExamEditor />} />
            <Route path="exams/:id" element={<ExamDetail />} />
            <Route path="exams/:id/edit" element={<ExamEditor key="edit" />} />
            <Route path="participants" element={<ParticipantsAdmin />} />
            <Route path="settings" element={<SettingsAdmin />} />
            <Route path="import" element={<ImportAdmin />} />
            <Route path="audit" element={<AuditAdmin />} />
          </Routes>
        </main>
      </div>
    </LanguageProvider>
  );
}
