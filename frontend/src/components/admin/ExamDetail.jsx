import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatDuration } from '../../api.js';
import BarChart from '../BarChart.jsx';
import ScoreBar from '../ScoreBar.jsx';
import Modal from '../Modal.jsx';
import { ResultCard } from '../../pages/Result.jsx';
import { AddParticipantForm, CsvUpload } from './ParticipantForms.jsx';

function statusBadge(p) {
  if (p.status === 'submitted') return <span className="badge badge-submitted">Submitted</span>;
  if (p.status === 'in_progress') return <span className="badge badge-in_progress">In progress</span>;
  return <span className="badge">Not yet</span>;
}

function ParticipantsTab({ exam, participants, reload, onView }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showCsv, setShowCsv] = useState(false);

  async function unassign(p) {
    if (!window.confirm(`Remove ${p.name} from this exam? Their login is kept.`)) return;
    await api(`/admin/exams/${exam.id}/participants/${encodeURIComponent(p.username)}`, { method: 'DELETE' });
    reload();
  }
  async function reset(p) {
    if (!window.confirm(`Delete ${p.name}'s attempt so they can retake the exam? Their submitted answers will be removed from the Excel file.`)) return;
    await api(`/admin/exams/${exam.id}/attempts/${encodeURIComponent(p.username)}`, { method: 'DELETE' });
    reload();
  }

  return (
    <div className="stack">
      <div className="row-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAdd((v) => !v)}>+ Add participant</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCsv((v) => !v)}>Bulk upload CSV</button>
      </div>
      {showAdd && <div className="card"><AddParticipantForm examId={exam.id} onDone={reload} /></div>}
      {showCsv && <div className="card"><CsvUpload examId={exam.id} onDone={reload} /></div>}
      {participants.length === 0 ? (
        <p className="muted">No participants assigned yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Status</th>
                <th>Submitted</th>
                <th className="num">Score</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.username}>
                  <td>{p.name}</td>
                  <td className="mono">{p.username}</td>
                  <td>{statusBadge(p)}</td>
                  <td className="small">{p.submittedAt ? new Date(p.submittedAt).toLocaleString() : '—'}</td>
                  <td className="num">{p.totalPct !== null ? `${p.totalPct}%` : '—'}</td>
                  <td className="row-actions nowrap">
                    {p.status === 'submitted' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onView(p)}>View</button>
                    )}
                    {p.status !== 'not_started' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => reset(p)}>Reset</button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => unassign(p)}>Remove</button>
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

function ResultsTab({ participants, onView }) {
  const done = participants.filter((p) => p.status === 'submitted');
  if (!done.length) return <p className="muted">No submissions yet.</p>;
  const sectionNos = [...new Set(done.flatMap((p) => p.sections.map((s) => s.no)))].sort((a, b) => a - b);
  const sectionName = (no) => (done.flatMap((p) => p.sections).find((s) => s.no === no) || {}).name;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th className="num">Correct</th>
            <th className="num">Total %</th>
            {sectionNos.map((n) => <th className="num" key={n}>S{n} {sectionName(n)} %</th>)}
            <th className="num">Knowledge %</th>
            <th className="num">Behaviour %</th>
            <th className="num">Time</th>
            <th>Unlocks</th>
          </tr>
        </thead>
        <tbody>
          {done
            .sort((a, b) => b.totalPct - a.totalPct)
            .map((p) => (
              <tr key={p.username} className="clickable" onClick={() => onView(p)}>
                <td>{p.name}</td>
                <td className="num">{p.correct}/{p.total}</td>
                <td className="num"><strong>{p.totalPct}%</strong></td>
                {sectionNos.map((n) => <td className="num" key={n}>{(p.sections.find((s) => s.no === n) || {}).pct ?? '—'}</td>)}
                <td className="num">{p.knowledgePct ?? '—'}</td>
                <td className="num">{p.behaviourPct ?? '—'}</td>
                <td className="num mono">{formatDuration(p.totalSeconds)}</td>
                <td className="small">{p.unlocked ? 'Visible' : new Date(p.unlockAt).toLocaleDateString()}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalyticsTab({ examId }) {
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api(`/admin/exams/${examId}/analytics`)
      .then((d) => setA(d.analytics))
      .catch((e) => setError(e.message));
  }, [examId]);
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!a) return <p className="muted">Loading…</p>;
  if (!a.participants) return <p className="muted">Analytics appear after the first submission.</p>;

  return (
    <div className="stack">
      <div className="stat-row">
        <div className="stat"><span className="stat-value">{a.participants}</span><span className="stat-label">Submissions</span></div>
        <div className="stat"><span className="stat-value">{a.averageScore}%</span><span className="stat-label">Average score</span></div>
        <div className="stat"><span className="stat-value mono">{formatDuration(a.averageSeconds)}</span><span className="stat-label">Average time</span></div>
      </div>
      <div className="grid-2">
        <div className="card">
          <BarChart
            title="Score distribution (participants per score band)"
            data={a.scoreDistribution.map((b) => ({ label: `${b.label}%`, short: b.label.split('-')[0], value: b.count, detail: 'participants' }))}
          />
        </div>
        <div className="card">
          <BarChart
            title="Time distribution (participants per duration)"
            data={a.timeDistribution.map((b) => ({ label: b.label, short: b.label.replace(' min', ''), value: b.count, detail: 'participants' }))}
          />
        </div>
      </div>
      <div className="card">
        <h3>Section-wise average</h3>
        {a.sections.map((s) => (
          <ScoreBar key={s.key} label={`${s.name} (high ${s.highest}%, low ${s.lowest}%)`} value={s.average} />
        ))}
      </div>
      <div className="card">
        <BarChart
          title="Question-level accuracy (% of participants correct)"
          unit="%"
          max={100}
          data={a.questions.map((q) => ({ label: `Q${q.no} · ${q.category || q.section}`, short: q.no, value: q.accuracy, detail: q.text }))}
        />
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Most often answered wrong</h3>
          <table className="table table-compact">
            <thead><tr><th>Q</th><th>Question</th><th className="num">Correct</th></tr></thead>
            <tbody>
              {a.hardest.map((q) => (
                <tr key={q.no}><td>{q.no}</td><td className="truncate">{q.text}</td><td className="num">{q.accuracy}%</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Most flagged questions</h3>
          {a.mostFlagged.length === 0 ? (
            <p className="muted">No question was flagged.</p>
          ) : (
            <table className="table table-compact">
              <thead><tr><th>Q</th><th>Question</th><th className="num">Flags</th></tr></thead>
              <tbody>
                {a.mostFlagged.map((q) => (
                  <tr key={q.no}><td>{q.no}</td><td className="truncate">{q.text}</td><td className="num">{q.flagged}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card">
        <h3>Average time per question</h3>
        <table className="table table-compact">
          <thead><tr><th>Q</th><th>Category</th><th className="num">Avg time (s)</th><th className="num">Avg changes</th><th className="num">Correct</th></tr></thead>
          <tbody>
            {a.questions.map((q) => (
              <tr key={q.no}><td>{q.no}</td><td>{q.category}</td><td className="num">{q.avgTime}</td><td className="num">{q.avgChanges}</td><td className="num">{q.accuracy}%</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Participant ranking</h3>
        <table className="table table-compact">
          <thead><tr><th>Rank</th><th>Name</th><th className="num">Score</th><th className="num">Time</th></tr></thead>
          <tbody>
            {a.ranking.map((r) => (
              <tr key={r.username}><td>{r.rank}</td><td>{r.name}</td><td className="num">{r.totalPct}%</td><td className="num mono">{r.totalTime}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResultModal({ exam, participant, onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    api(`/admin/exams/${exam.id}/results/${encodeURIComponent(participant.username)}`).then(setD);
  }, [exam.id, participant.username]);
  return (
    <Modal title={`${participant.name} — result`} onClose={onClose}>
      {!d ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="stack modal-scroll">
          <ResultCard exam={exam} result={d.result} />
          <h3>Question-wise responses</h3>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr><th>Q</th><th>Category</th><th>Selected</th><th>Correct</th><th className="num">Time (s)</th><th className="num">Changed</th><th>Flag</th></tr>
              </thead>
              <tbody>
                {d.responses.map((r) => (
                  <tr key={r['Question No']}>
                    <td>{r['Question No']}</td>
                    <td>{r.Category}</td>
                    <td>{r['Option Selected']}</td>
                    <td>{r['Correct Y/N'] === 'Y' ? <span className="badge badge-ok">Y</span> : <span className="badge badge-bad">N</span>}</td>
                    <td className="num">{r['Time on Question (seconds)']}</td>
                    <td className="num">{r['Times Changed']}</td>
                    <td>{r['Flagged Y/N'] === 'Y' ? '⚑' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

export default function ExamDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [tab, setTab] = useState('participants');
  const [viewing, setViewing] = useState(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api(`/admin/exams/${id}`)
      .then((d) => setExam({ ...d.exam, questionCount: d.sections.reduce((n, s) => n + s.questions.length, 0), sectionCount: d.sections.length }))
      .catch((e) => setError(e.message));
    api(`/admin/exams/${id}/participants`).then((d) => setParticipants(d.participants));
  }, [id]);

  useEffect(reload, [reload]);

  async function setStatus(status) {
    await api(`/admin/exams/${id}/status`, { method: 'PATCH', body: { status } });
    reload();
  }
  async function remove() {
    if (!window.confirm(`Permanently delete "${exam.title}" and its Excel file? Download the Excel first if you need it.`)) return;
    await api(`/admin/exams/${id}`, { method: 'DELETE' });
    navigate('/admin');
  }

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!exam) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <Link to="/admin" className="muted small">← All exams</Link>
      <div className="page-head">
        <div>
          <h1>{exam.title}</h1>
          <p className="muted">
            {[exam.team, exam.site, exam.examDate].filter(Boolean).join(' · ')} · {exam.sectionCount} section(s), {exam.questionCount} questions · results unlock {exam.unlockDays} day(s) after submission
          </p>
        </div>
        <div className="row-actions">
          <select value={exam.status} onChange={(e) => setStatus(e.target.value)} aria-label="Exam status">
            <option>Active</option>
            <option>Closed</option>
            <option>Results Released</option>
          </select>
          <Link className="btn btn-secondary" to={`/admin/exams/${id}/edit`}>Edit</Link>
          <a className="btn btn-primary" href={`/api/admin/exams/${id}/download`}>⬇ Download Excel</a>
          <button type="button" className="btn btn-danger" onClick={remove}>Delete</button>
        </div>
      </div>
      <div className="stat-row">
        <div className="stat"><span className="stat-value">{exam.participants}</span><span className="stat-label">Assigned</span></div>
        <div className="stat"><span className="stat-value">{exam.submitted}</span><span className="stat-label">Submitted</span></div>
        <div className="stat"><span className="stat-value">{exam.inProgress}</span><span className="stat-label">In progress</span></div>
        <div className="stat"><span className="stat-value">{Math.max(0, exam.participants - exam.submitted - exam.inProgress)}</span><span className="stat-label">Not started</span></div>
      </div>
      <div className="tabs" role="tablist">
        {[['participants', 'Participants'], ['results', 'Results'], ['analytics', 'Analytics']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'participants' && <ParticipantsTab exam={exam} participants={participants} reload={reload} onView={setViewing} />}
      {tab === 'results' && <ResultsTab participants={participants} onView={setViewing} />}
      {tab === 'analytics' && <AnalyticsTab examId={id} />}
      {viewing && <ResultModal exam={exam} participant={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
