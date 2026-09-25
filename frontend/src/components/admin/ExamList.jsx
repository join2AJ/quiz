import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';

export default function ExamList() {
  const [exams, setExams] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/admin/exams')
      .then((d) => setExams(d.exams))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Exams</h1>
        <Link className="btn btn-primary" to="/admin/exams/new">+ Create new exam</Link>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {!exams && !error && <p className="muted">Loading…</p>}
      {exams && exams.length === 0 && (
        <div className="card">
          <h2>No exams yet</h2>
          <p className="muted">Import your question database (questions, staff logins and scoring in one step), or create an exam by hand.</p>
          <div className="row-actions">
            <Link className="btn btn-primary" to="/admin/import">Import database JSON</Link>
            <Link className="btn btn-secondary" to="/admin/exams/new">Create exam manually</Link>
          </div>
        </div>
      )}
      {exams && exams.length > 0 && (
        <div className="table-wrap card flush">
          <table className="table">
            <thead>
              <tr>
                <th>Exam</th>
                <th>Date</th>
                <th>Status</th>
                <th className="num">Questions</th>
                <th className="num">Submitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {exams.map((e) => (
                <tr key={e.id}>
                  <td>
                    <Link to={`/admin/exams/${e.id}`}><strong>{e.title}</strong></Link>
                    <div className="muted small">{[e.team, e.site].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="nowrap">{e.examDate}</td>
                  <td><span className={`badge badge-status-${e.status.replace(/\s/g, '')}`}>{e.status}</span></td>
                  <td className="num">{e.questionCount}</td>
                  <td className="num">{e.submitted} / {e.participants}</td>
                  <td className="row-actions nowrap">
                    <Link className="btn btn-ghost btn-sm" to={`/admin/exams/${e.id}`}>Open</Link>
                    <a className="btn btn-ghost btn-sm" href={`/api/admin/exams/${e.id}/download`}>⬇ Excel</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
