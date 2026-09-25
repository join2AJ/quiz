import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { AddParticipantForm, CsvUpload } from './ParticipantForms.jsx';

export default function ParticipantsAdmin() {
  const [users, setUsers] = useState([]);
  const [exams, setExams] = useState([]);
  const [filter, setFilter] = useState('');
  const [assignTo, setAssignTo] = useState({});

  const reload = useCallback(() => {
    api('/admin/users').then((d) => setUsers(d.users));
    api('/admin/exams').then((d) => setExams(d.exams));
  }, []);
  useEffect(reload, [reload]);

  const examTitle = (id) => (exams.find((e) => e.id === id) || {}).title || id;

  async function assign(username) {
    const examId = assignTo[username];
    if (!examId) return;
    await api(`/admin/users/${encodeURIComponent(username)}/assign`, { method: 'POST', body: { examId } });
    reload();
  }
  async function remove(u) {
    if (!window.confirm(`Delete participant ${u.name} (${u.username})? They will no longer be able to log in. Submitted results stay in the Excel files.`)) return;
    await api(`/admin/users/${encodeURIComponent(u.username)}`, { method: 'DELETE' });
    reload();
  }

  const shown = users.filter((u) => `${u.name} ${u.username}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="stack">
      <h1>Participants</h1>
      <div className="grid-2">
        <div className="card">
          <h2>Add participant</h2>
          <AddParticipantForm exams={exams} onDone={reload} />
        </div>
        <div className="card">
          <h2>Bulk upload (CSV)</h2>
          <CsvUpload exams={exams} onDone={reload} />
        </div>
      </div>
      <div className="card">
        <div className="page-head">
          <h2>All participants ({users.length})</h2>
          <input className="search" placeholder="Search name or username" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Username</th><th className="hide-sm">Designation / Shift</th><th>Assigned exams</th><th>Assign to exam</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.username}>
                  <td>{u.name}</td>
                  <td className="mono">{u.username}</td>
                  <td className="small hide-sm">{[u.designation, u.shift].filter(Boolean).join(' · ')}</td>
                  <td className="small">{u.examIds.length ? u.examIds.map(examTitle).join(', ') : <span className="muted">none</span>}</td>
                  <td className="nowrap">
                    <select value={assignTo[u.username] || ''} onChange={(e) => setAssignTo((a) => ({ ...a, [u.username]: e.target.value }))}>
                      <option value="">Select exam…</option>
                      {exams.filter((e) => !u.examIds.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                    </select>{' '}
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!assignTo[u.username]} onClick={() => assign(u.username)}>Assign</button>
                  </td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(u)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
