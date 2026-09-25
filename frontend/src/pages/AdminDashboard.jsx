import { NavLink, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../context/LanguageContext.jsx';
import TopBar from '../components/TopBar.jsx';
import ExamList from '../components/admin/ExamList.jsx';
import ExamEditor from '../components/admin/ExamEditor.jsx';
import ExamDetail from '../components/admin/ExamDetail.jsx';
import ParticipantsAdmin from '../components/admin/ParticipantsAdmin.jsx';
import SettingsAdmin from '../components/admin/SettingsAdmin.jsx';

/** Admin panel — English only. */
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
          <NavLink to="/admin/settings">Settings</NavLink>
        </nav>
        <main className="container wide">
          <Routes>
            <Route index element={<ExamList />} />
            <Route path="exams/new" element={<ExamEditor />} />
            <Route path="exams/:id" element={<ExamDetail />} />
            <Route path="exams/:id/edit" element={<ExamEditor key="edit" />} />
            <Route path="participants" element={<ParticipantsAdmin />} />
            <Route path="settings" element={<SettingsAdmin />} />
          </Routes>
        </main>
      </div>
    </LanguageProvider>
  );
}
