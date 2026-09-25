import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatDuration } from '../../api.js';
import BarChart from '../BarChart.jsx';
import ScoreBar from '../ScoreBar.jsx';
import Modal from '../Modal.jsx';
import { ResultCard } from '../../pages/Result.jsx';
import { AddParticipantForm, CsvUpload } from './ParticipantForms.jsx';
import QuestionBank from './QuestionBank.jsx';
import TagsTab from './TagsTab.jsx';
import FindReplace from './FindReplace.jsx';
import {
  AnswerBody, Chip, ENGAGEMENT, HEADLINE_TONE, InsightGrid, InsightItem, KIND_CHIP, Kpi, KpiRow, Legend, PctChip, toneOf,
} from './Insights.jsx';

const KIND = {
  correct: 'Full credit',
  acceptable: 'Partial credit',
  neutral: 'Neutral',
  concern: 'Concern',
  incorrect: 'Wrong',
};
const KIND_CLASS = {
  'Correct / Preferred': 'correct',
  'Acceptable (partial)': 'acceptable',
  Concern: 'concern',
  Neutral: 'neutral',
  Incorrect: 'incorrect',
  Unanswered: 'incorrect',
};

const isWide = (x) => Boolean(x.list || (x.people && x.people.length));

/** Plain-language summary for leaders: headline, key numbers, one paragraph and colour-coded answers. */
function LeaderCard({ title, subtitle, headline, paragraph, answers, kpis, strengths, gaps }) {
  const lead = answers.filter((x) => x.key !== 'next');
  const next = answers.find((x) => x.key === 'next');
  return (
    <section className={`leader-card leader-${HEADLINE_TONE[headline] || 'info'}`}>
      <header className="leader-head">
        <div>
          <h3 className="leader-title">{title}</h3>
          {subtitle && <div className="small muted">{subtitle}</div>}
        </div>
        {headline && <Chip tone={HEADLINE_TONE[headline] || 'info'} strong>{headline}</Chip>}
      </header>
      {kpis}
      <p className="leader-para">{paragraph}</p>
      {((strengths && strengths.length > 0) || (gaps && gaps.length > 0)) && (
        <div className="sg-grid">
          {strengths && strengths.length > 0 && (
            <div>
              <div className="sg-label sg-good">Strong in</div>
              <div className="chip-row">{strengths.map((x) => <Chip key={x} tone="good">{x}</Chip>)}</div>
            </div>
          )}
          {gaps && gaps.length > 0 && (
            <div>
              <div className="sg-label sg-bad">Needs work on</div>
              <div className="chip-row">{gaps.map((x) => <Chip key={x} tone="warn">{x}</Chip>)}</div>
            </div>
          )}
        </div>
      )}
      <InsightGrid>
        {lead.filter((x) => !isWide(x)).map((x) => (
          <InsightItem key={x.q} q={x.q} tone={x.tone || 'info'}>
            <AnswerBody x={x} />
          </InsightItem>
        ))}
      </InsightGrid>
      {lead.filter(isWide).map((x) => (
        <InsightItem key={x.q} q={x.q} tone={x.tone || 'info'}>
          <AnswerBody x={x} />
        </InsightItem>
      ))}
      {next && (
        <div className="next-step">
          <span className="next-step-label">Recommended next step</span>
          <p>{next.a}</p>
        </div>
      )}
    </section>
  );
}

const TOO_FAST = 5;

function PostureCard({ p, compact = false }) {
  if (!p) return null;
  return (
    <div className="posture-card stack-sm">
      <div className="row-actions">
        {!compact && <strong>{p.name}</strong>}
        <span className={`badge posture-${p.level}`}>{p.label}</span>
        <span className="small muted">Alignment {p.alignment}% across {p.situations} situations</span>
      </div>
      <div className="posture-counts">
        <span className="kind-correct">Preferred {p.counts.correct}</span>
        <span className="kind-acceptable">Acceptable {p.counts.acceptable}</span>
        <span className="kind-neutral">Neutral {p.counts.neutral}</span>
        <span className="kind-concern">Concern {p.counts.concern}</span>
        {p.counts.incorrect > 0 && <span className="kind-incorrect">Other {p.counts.incorrect}</span>}
        {p.counts.unanswered > 0 && <span className="muted">Unanswered {p.counts.unanswered}</span>}
      </div>
      <p className="small" style={{ margin: 0 }}>{p.summary}</p>
      {p.dimensions.length > 0 && (
        <details>
          <summary className="small">Quality-wise alignment{p.concerns.length ? ' and concern answers' : ''}</summary>
          <div className="stack-sm" style={{ marginTop: '0.5rem' }}>
            {p.dimensions.map((d) => <ScoreBar key={d.key} label={d.label} value={d.pct} />)}
            {p.tendencies.length > 0 && <p className="small"><b>Tendencies:</b> {p.tendencies.join('; ')}</p>}
            {p.concerns.map((c) => (
              <div key={c.qid} className="small kind-concern">{c.qid} ({c.category}) — chose {c.option}: {c.interpretation}</div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

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
                <th className="hide-sm">Designation / Shift</th>
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
                  <td className="small hide-sm">{[p.designation, p.shift].filter(Boolean).join(' · ')}</td>
                  <td>{statusBadge(p)}</td>
                  <td className="small">{p.submittedAt ? new Date(p.submittedAt).toLocaleString() : '—'}</td>
                  <td className="num">{p.totalPct !== null ? `${p.totalPct}%` : '—'}</td>
                  <td className="row-actions nowrap">
                    {p.status === 'submitted' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onView(p)}>Summary</button>
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

function ResultsTab({ examId, participants, onView }) {
  const [people, setPeople] = useState(null);
  useEffect(() => {
    api(`/admin/exams/${examId}/analytics`)
      .then((d) => setPeople(new Map(((d.team && d.team.people) || []).map((p) => [p.username, p]))))
      .catch(() => setPeople(new Map()));
  }, [examId]);
  const done = participants.filter((p) => p.status === 'submitted');
  if (!done.length) return <p className="muted">No submissions yet.</p>;
  const sectionNos = [...new Set(done.flatMap((p) => p.sections.map((s) => s.no)))].sort((a, b) => a - b);
  const sectionName = (no) => (done.flatMap((p) => p.sections).find((s) => s.no === no) || {}).name;
  return (
    <div className="stack">
      <div className="results-head">
        <p className="muted small" style={{ margin: 0 }}>Highest score first. Click a row for the full summary.</p>
        <Legend />
      </div>
      <div className="table-wrap results-table">
        <table className="table table-roomy">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Verdict</th>
              <th className="num">Score</th>
              <th className="num">Knowledge</th>
              <th className="num">Behaviour</th>
              {sectionNos.map((n) => <th className="num hide-sm" key={n} title={sectionName(n)}>Part {n}<div className="th-sub">{sectionName(n)}</div></th>)}
              <th>Seriousness</th>
              <th className="num">Concerns</th>
              <th className="num">Time</th>
              <th>Result visible</th>
            </tr>
          </thead>
          <tbody>
            {[...done]
              .sort((a, b) => b.totalPct - a.totalPct)
              .map((p, i) => {
                const x = people && people.get(p.username);
                const eng = x && ENGAGEMENT[x.level];
                return (
                  <tr key={p.username} className={`clickable row-${x ? HEADLINE_TONE[x.headline] : 'none'}`} onClick={() => onView(p)}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <div className="cell-name">{p.name}</div>
                      <div className="small muted nowrap">{p.correct}/{p.total} points</div>
                    </td>
                    <td>{x ? <Chip tone={HEADLINE_TONE[x.headline] || 'info'}>{x.headline}</Chip> : <span className="muted">…</span>}</td>
                    <td className="num"><PctChip value={p.totalPct} /></td>
                    <td className="num"><PctChip value={p.knowledgePct} /></td>
                    <td className="num"><PctChip value={p.behaviourPct} /></td>
                    {sectionNos.map((n) => <td className="num hide-sm" key={n}><PctChip value={(p.sections.find((s) => s.no === n) || {}).pct} /></td>)}
                    <td>{eng ? <Chip tone={eng.tone} title={`About ${x.avgSeconds}s per question`}>{eng.label}</Chip> : '—'}</td>
                    <td className="num">{x ? (x.concerns ? <Chip tone={x.concerns >= 3 ? 'bad' : 'warn'}>{x.concerns}</Chip> : <span className="muted">0</span>) : '—'}</td>
                    <td className="num mono">{formatDuration(p.totalSeconds)}</td>
                    <td className="small">{p.unlocked ? <Chip tone="good">Visible</Chip> : new Date(p.unlockAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalyticsTab({ examId }) {
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  const [teamSummary, setTeamSummary] = useState(null);
  useEffect(() => {
    api(`/admin/exams/${examId}/analytics`)
      .then((d) => {
        setA(d.analytics);
        setTeamSummary(d.team);
      })
      .catch((e) => setError(e.message));
  }, [examId]);
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!a) return <p className="muted">Loading…</p>;
  if (!a.participants) return <p className="muted">Analytics appear after the first submission.</p>;

  return (
    <div className="stack">
      {teamSummary && (
        <LeaderCard
          title="Team summary"
          subtitle="Plain-language answers for leaders. Colours: green good, amber watch, red act."
          paragraph={teamSummary.paragraph}
          answers={teamSummary.answers}
          kpis={teamSummary.stats && (
            <KpiRow>
              <Kpi label="Submitted" value={`${teamSummary.stats.submitted}/${teamSummary.stats.assigned}`} sub="people" tone={teamSummary.stats.submitted >= teamSummary.stats.assigned ? 'good' : 'info'} />
              <Kpi label="Team average" value={`${teamSummary.stats.average}%`} tone={toneOf(teamSummary.stats.average)} sub={teamSummary.stats.best ? `High ${teamSummary.stats.best.pct}% · Low ${teamSummary.stats.worst.pct}%` : ''} />
              <Kpi label="Need attention" value={teamSummary.stats.attention} sub="people" tone={teamSummary.stats.attention ? 'bad' : 'good'} />
              <Kpi label="Rushed" value={teamSummary.stats.rushed} sub="unreliable results" tone={teamSummary.stats.rushed ? 'bad' : 'good'} />
              <Kpi label="Concern answers" value={teamSummary.stats.concernAnswers} sub="across the team" tone={teamSummary.stats.concernAnswers ? 'warn' : 'good'} />
              <Kpi label="Question reports" value={teamSummary.stats.reports} tone={teamSummary.stats.reports ? 'warn' : 'good'} />
            </KpiRow>
          )}
        />
      )}
      {teamSummary && teamSummary.dimensions && teamSummary.dimensions.length > 0 && (
        <section className="card">
          <h3 className="section-title">Team strengths and weaknesses</h3>
          <p className="muted small">Average score per quality, strongest first.</p>
          <div className="dim-grid">
            {teamSummary.dimensions.map((d) => <ScoreBar key={d.key} label={d.label} value={d.average} colored />)}
          </div>
        </section>
      )}
      <details className="card">
        <summary><b>Detailed analytics</b> <span className="muted small">— charts, every question, behaviour patterns, individual profiles</span></summary>
      <div className="stack" style={{ marginTop: '1rem' }}>
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
      {a.dimensions && a.dimensions.length > 0 && (
        <div className="card">
          <h3>Dimension-wise average</h3>
          {['KNOWLEDGE', 'BEHAVIOUR', ''].map((g) => {
            const list = a.dimensions.filter((d) => (g ? d.group === g : !['KNOWLEDGE', 'BEHAVIOUR'].includes(d.group)));
            if (!list.length) return null;
            return (
              <div key={g || 'other'} className="dimension-group">
                {g && <h3>{g === 'KNOWLEDGE' ? 'Knowledge' : 'Behaviour'}</h3>}
                {list.map((d) => <ScoreBar key={d.key} label={d.label} value={d.average} />)}
              </div>
            );
          })}
        </div>
      )}
      {a.postures && a.postures.length > 0 && (
        <div className="card stack-sm">
          <h3>Behaviour posture by individual (admin only)</h3>
          <p className="muted small">
            How each person tends to respond in workplace situations: how often they chose the preferred, acceptable, neutral or
            concern response, alignment per quality, and the tendencies their other answers reveal. Lowest alignment first.
            Use it as a conversation starter, not as a verdict.
          </p>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr><th>Participant</th><th>Posture</th><th className="num">Alignment</th><th className="num">Pref.</th><th className="num">Accept.</th><th className="num">Neutral</th><th className="num">Concern</th><th>Strengths</th><th>Develop</th></tr>
              </thead>
              <tbody>
                {a.postures.map((p) => (
                  <tr key={p.username}>
                    <td>{p.name}</td>
                    <td><span className={`badge posture-${p.level}`}>{p.label}</span></td>
                    <td className="num">{p.alignment}%</td>
                    <td className="num">{p.counts.correct}</td>
                    <td className="num">{p.counts.acceptable}</td>
                    <td className="num">{p.counts.neutral}</td>
                    <td className={`num ${p.counts.concern ? 'kind-concern' : ''}`}>{p.counts.concern}</td>
                    <td className="small">{p.strengths.join(', ') || '—'}</td>
                    <td className="small">{p.development.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Individual profiles</h3>
          {a.postures.map((p) => <PostureCard key={p.username} p={p} />)}
        </div>
      )}
      {a.tags && a.tags.length > 0 && (
        <div className="card">
          <h3>Performance by tag</h3>
          <table className="table table-compact">
            <thead><tr><th>Tag</th><th className="num">Questions</th><th className="num">Average score</th><th>Question IDs</th></tr></thead>
            <tbody>
              {a.tags.map((t) => (
                <tr key={t.tag}><td>#{t.tag}</td><td className="num">{t.questions.length}</td><td className="num">{t.average ?? '—'}{t.average !== null ? '%' : ''}</td><td className="small">{t.questions.join(', ')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.behaviour && a.behaviour.length > 0 && (
        <div className="card">
          <h3>Behaviour answer patterns (admin only)</h3>
          <p className="muted small">What each option reveals, and how many people chose it. Concern options are highlighted.</p>
          {a.behaviour.map((q) => (
            <details key={q.no} className="q-editor" style={{ marginBottom: '0.5rem' }}>
              <summary>
                <span className="q-editor-no">{q.qid || q.no}</span>
                <span className="truncate">{q.category} — {q.text}</span>
                {q.options.some((o) => o.kind === 'concern' && o.count) && (
                  <span className="badge badge-bad">{q.options.filter((o) => o.kind === 'concern').reduce((n, o) => n + o.count, 0)} concern</span>
                )}
              </summary>
              <div className="q-editor-body">
                <table className="table table-compact">
                  <thead><tr><th>Option</th><th>Chosen</th><th>Scored as</th><th>What it reveals</th></tr></thead>
                  <tbody>
                    {q.options.map((o) => (
                      <tr key={o.option}>
                        <td><strong>{o.option}</strong></td>
                        <td className="nowrap">
                          <span className={`opt-bar ${o.kind === 'concern' ? 'concern' : ''}`} style={{ width: `${q.attempts ? (o.count / q.attempts) * 80 : 0}px` }} />
                          {o.count}
                        </td>
                        <td className={`kind-${o.kind}`}>{KIND[o.kind] || '—'}</td>
                        <td className="small">{o.interpretation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {q.unanswered > 0 && <p className="muted small">Unanswered: {q.unanswered}</p>}
              </div>
            </details>
          ))}
        </div>
      )}
      <div className="grid-2">
        <div className="card">
          <h3>Concern answers</h3>
          {!a.concerns || a.concerns.length === 0 ? (
            <p className="muted">No concern options were chosen.</p>
          ) : (
            <table className="table table-compact">
              <thead><tr><th>Participant</th><th>Q</th><th>Opt</th><th>What it reveals</th></tr></thead>
              <tbody>
                {a.concerns.map((c) => (
                  <tr key={`${c.username}-${c.no}`}><td>{c.name}</td><td>{c.qid || c.no}</td><td>{c.option}</td><td className="small">{c.interpretation}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>Integrity signals</h3>
          <p className="muted small">Tab switches use the browser's Page Visibility API. A few short switches can be innocent (for example, a notification). Look for patterns.</p>
          <table className="table table-compact">
            <thead><tr><th>Participant</th><th className="num">Tab switches</th><th className="num">Time away</th><th className="num">Changes</th><th className="num">Lang</th></tr></thead>
            <tbody>
              {(a.integrity || []).map((r) => (
                <tr key={r.username}>
                  <td>{r.name}</td>
                  <td className={`num ${r.tabSwitches ? 'kind-concern' : ''}`}>{r.tabSwitches}</td>
                  <td className="num mono">{r.timeAway}</td>
                  <td className="num">{r.answerChanges}</td>
                  <td className="num">{r.languageToggles}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
          title="Question-level score (average % of points earned)"
          unit="%"
          max={100}
          data={a.questions.map((q) => ({ label: `${q.qid || `Q${q.no}`} · ${q.category || q.section}`, short: q.no, value: q.accuracy, detail: q.text }))}
        />
      </div>
      <div className="grid-2">
        <div className="card">
          <h3>Lowest-scoring questions</h3>
          <table className="table table-compact">
            <thead><tr><th>Q</th><th>Question</th><th className="num">Score</th></tr></thead>
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
      </details>
    </div>
  );
}

function answerKind(r) {
  if (!r['Option Selected'] || r['Option Selected'] === '—') return 'unanswered';
  return KIND_CLASS[r['Response Type']] || (r['Correct Y/N'] === 'Y' ? 'correct' : 'incorrect');
}

function partName(section) {
  return String(section || 'Questions').replace(/^Section\s+\d+\s+—\s+/, '');
}

/** Every answer, grouped by part, with colour-coded results. */
function AnswerGroups({ responses }) {
  const [filter, setFilter] = useState('all');
  const groups = [];
  for (const r of responses) {
    const key = r.Section || 'Questions';
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, rows: [] }));
    g.rows.push(r);
  }
  const notBest = responses.filter((r) => answerKind(r) !== 'correct').length;
  return (
    <div className="stack">
      <div className="results-head">
        <div className="segmented" role="group" aria-label="Filter answers">
          <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All answers ({responses.length})</button>
          <button type="button" className={filter === 'review' ? 'on' : ''} onClick={() => setFilter('review')}>Not the best answer ({notBest})</button>
        </div>
        <span className="small muted"><Chip tone="bad">3s</Chip> = answered in under {TOO_FAST} seconds</span>
      </div>
      {groups.map((g) => {
        const counts = {};
        for (const r of g.rows) counts[answerKind(r)] = (counts[answerKind(r)] || 0) + 1;
        const rows = filter === 'all' ? g.rows : g.rows.filter((r) => answerKind(r) !== 'correct');
        const pct = Math.round(((counts.correct || 0) / g.rows.length) * 100);
        return (
          <details key={g.key} className="answer-group" open>
            <summary>
              <span className="answer-group-title">{partName(g.key)}</span>
              <span className="chip-row">
                <PctChip value={pct} suffix="% best" />
                {Object.entries(KIND_CHIP).map(([k, v]) => (counts[k] ? <Chip key={k} tone={v.tone}>{counts[k]} {v.label.toLowerCase()}</Chip> : null))}
              </span>
            </summary>
            {rows.length === 0 ? (
              <p className="muted small answer-empty">All answers in this part were the best answer.</p>
            ) : (
              <ul className="answer-list">
                {rows.map((r) => {
                  const kind = answerKind(r);
                  const chip = KIND_CHIP[kind];
                  const secs = Number(r['Active Time on Question (seconds)'] ?? r['Time on Question (seconds)']) || 0;
                  const answered = kind !== 'unanswered';
                  return (
                    <li key={r['Question No']} className={`answer-row answer-${chip.tone}`}>
                      <div className="answer-main">
                        <span className="mono qid">{r.QID || `Q${r['Question No']}`}</span>
                        <span className="answer-topic">{r.Category || '—'}</span>
                        <span className="chip-row answer-meta">
                          <Chip tone={chip.tone} strong>{chip.label}</Chip>
                          <span className="small muted">{r.Points ?? (r['Correct Y/N'] === 'Y' ? 1 : 0)}{r.Weight ? `/${r.Weight}` : ''} pts</span>
                          <Chip tone={answered && secs < TOO_FAST ? 'bad' : 'muted'} title="Seconds spent on this question">{secs}s</Chip>
                        </span>
                      </div>
                      <div className="answer-detail">
                        {r['Question Text (EN)'] && <div className="answer-question">{r['Question Text (EN)']}</div>}
                        <div>
                          <span className="answer-label">Chose</span>
                          <b className={`answer-letter answer-${chip.tone}`}>{answered ? r['Option Selected'] : '—'}</b>
                          {r['Chosen Text'] && <span className="small">{r['Chosen Text']}</span>}
                        </div>
                        {kind !== 'correct' && r['Best Answer'] && (
                          <div>
                            <span className="answer-label">Best</span>
                            <b className="answer-letter answer-good">{r['Best Answer']}</b>
                            <span className="small">{r['Best Answer Text']}</span>
                            {r['Also Accepted'] && <span className="small muted"> · also accepted {r['Also Accepted']}</span>}
                          </div>
                        )}
                        {r.Interpretation && kind !== 'correct' && <div className="small answer-why">{r.Interpretation}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
        );
      })}
    </div>
  );
}

function ResultModal({ exam, participant, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('summary');
  useEffect(() => {
    api(`/admin/exams/${exam.id}/results/${encodeURIComponent(participant.username)}`)
      .then(setD)
      .catch((e) => setError(e.message));
  }, [exam.id, participant.username]);
  const L = d && d.leadership;
  const st = L && L.stats;
  const eng = L && ENGAGEMENT[L.engagement.level];
  return (
    <Modal title={`${participant.name} — summary`} onClose={onClose}>
      {error && <div className="alert alert-error">{error}</div>}
      {!d && !error ? (
        <p className="muted">Loading…</p>
      ) : d && (
        <div className="stack modal-scroll">
          <div className="tabs tabs-pill" role="tablist">
            {[['summary', 'Summary'], ['answers', 'Every answer'], ['behaviour', 'Behaviour'], ['card', 'Score card']].map(([k, label]) => (
              (k !== 'behaviour' || d.posture) && (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
              )
            ))}
          </div>

          {tab === 'summary' && L && (
            <LeaderCard
              title={participant.name}
              subtitle={[participant.designation, participant.shift, participant.username].filter(Boolean).join(' · ')}
              headline={L.headline}
              paragraph={L.paragraph}
              answers={L.answers}
              strengths={L.strengths}
              gaps={L.gaps}
              kpis={st && (
                <KpiRow>
                  <Kpi label="Overall" value={`${st.totalPct}%`} tone={toneOf(st.totalPct)} sub={L.rank ? `Rank ${L.rank} of ${L.of}` : ''} />
                  {st.knowledgePct !== null && st.knowledgePct !== undefined && <Kpi label="Knowledge" value={`${st.knowledgePct}%`} tone={toneOf(st.knowledgePct)} sub="rules & procedures" />}
                  {st.behaviourPct !== null && st.behaviourPct !== undefined && <Kpi label="Behaviour" value={`${st.behaviourPct}%`} tone={toneOf(st.behaviourPct)} sub="situations & values" />}
                  {eng && <Kpi label="Seriousness" value={eng.label} tone={eng.tone} sub={`~${st.avgSeconds}s per question`} />}
                  <Kpi label="Concerns" value={st.concerns} tone={st.concerns >= 3 ? 'bad' : st.concerns ? 'warn' : 'good'} sub="answers" />
                  <Kpi label="Left exam tab" value={st.tabSwitches} tone={st.tabSwitches >= 3 ? 'bad' : st.tabSwitches ? 'warn' : 'good'} sub="times" />
                </KpiRow>
              )}
            />
          )}

          {tab === 'answers' && <AnswerGroups responses={d.responses} />}

          {tab === 'behaviour' && d.posture && <PostureCard p={d.posture} compact />}

          {tab === 'card' && (
            <>
              <p className="muted small">What the participant sees after the unlock date.</p>
              <ResultCard exam={exam} result={d.result} />
            </>
          )}
        </div>
      )}
      <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

/** Problems with questions reported by participants during the exam. */
function ReportsTab({ examId }) {
  const [reports, setReports] = useState(null);
  useEffect(() => {
    api(`/admin/exams/${examId}/reports`).then((d) => setReports(d.reports)).catch(() => setReports([]));
  }, [examId]);
  const REASON = {
    unclear: 'Question unclear',
    translation: 'Translation wrong',
    multiple_correct: 'More than one correct answer',
    no_correct: 'No correct answer',
    spelling: 'Spelling / typing mistake',
    other: 'Other',
  };
  if (!reports) return <p className="muted">Loading…</p>;
  if (!reports.length) return <p className="muted">No question has been reported. Staff can report a problem with any question during the exam.</p>;
  const byQ = {};
  for (const r of reports) byQ[r.qid] = (byQ[r.qid] || 0) + 1;
  return (
    <div className="stack">
      <p className="muted small">Most reported: {Object.entries(byQ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([q, n]) => `${q} (${n})`).join(', ')}. Fix wording with Edit or Find &amp; replace.</p>
      <div className="table-wrap">
        <table className="table table-compact">
          <thead><tr><th>When</th><th>Question</th><th>Problem</th><th>Details</th><th>Reported by</th><th>Lang</th></tr></thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.seq}>
                <td className="nowrap small">{new Date(r.at).toLocaleString()}</td>
                <td><b>{r.qid}</b></td>
                <td>{REASON[r.reason] || r.reason}</td>
                <td className="small">{r.comment || '—'}</td>
                <td className="small">{r.name}</td>
                <td>{(r.language || '').toUpperCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ExamDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [exam, setExam] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [tab, setTab] = useState('questions');
  const [sections, setSections] = useState([]);
  const [replacing, setReplacing] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api(`/admin/exams/${id}`)
      .then((d) => {
        setSections(d.sections);
        setExam({ ...d.exam, questionCount: d.sections.reduce((n, s) => n + s.questions.length, 0), sectionCount: d.sections.length });
      })
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
          <button type="button" className="btn btn-secondary" onClick={() => setReplacing(true)}>Find &amp; replace</button>
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
        {[['questions', `Questions (${exam.questionCount})`], ['tags', 'Tags'], ['participants', 'Participants'], ['results', 'Results'], ['analytics', 'Analytics'], ['reports', 'Reports']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'questions' && <QuestionBank sections={sections} dimensions={(exam.config || {}).dimensions || {}} />}
      {tab === 'tags' && <TagsTab sections={sections} dimensions={(exam.config || {}).dimensions || {}} />}
      {tab === 'participants' && <ParticipantsTab exam={exam} participants={participants} reload={reload} onView={setViewing} />}
      {tab === 'results' && <ResultsTab examId={exam.id} participants={participants} onView={setViewing} />}
      {tab === 'analytics' && <AnalyticsTab examId={id} />}
      {tab === 'reports' && <ReportsTab examId={id} />}
      {replacing && <FindReplace examId={id} onClose={() => setReplacing(false)} onDone={reload} />}
      {viewing && <ResultModal exam={exam} participant={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
