/**
 * Plain-language summaries for leaders (admin only): a short paragraph and
 * answers to the questions a manager actually asks — how did they do, do they
 * know the rules, how do they behave, did they take it seriously, anything to
 * worry about, what next. Built from stored results; nothing here is shown to
 * participants.
 */
const scoring = require('./scoringService');

// An answer chosen faster than this is too quick to have read the question.
const TOO_FAST_SECONDS = 5;
const round = (n) => Math.round(n);

function label(pctValue) {
  if (pctValue === null || pctValue === undefined) return 'n/a';
  if (pctValue >= 85) return 'excellent';
  if (pctValue >= 70) return 'good';
  if (pctValue >= 50) return 'fair';
  return 'weak';
}

function list(items, max = 3) {
  const xs = items.filter(Boolean).slice(0, max);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** How seriously the person took the exam, from time per answer. */
function engagement(rows, exam) {
  const answered = rows.filter((r) => r['Option Selected'] && r['Option Selected'] !== '—');
  const secs = answered.map((r) => Number(r['Active Time on Question (seconds)'] ?? r['Time on Question (seconds)']) || 0);
  const tooFast = secs.filter((s) => s < TOO_FAST_SECONDS).length;
  const avg = secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length : 0;
  const timers = (exam && exam.config && exam.config.timerSeconds) || {};
  const suggested = rows.reduce((t, r) => t + (Number(timers[r.Type]) || 40), 0);
  const actual = secs.reduce((a, b) => a + b, 0);
  const share = answered.length ? tooFast / answered.length : 0;
  let level;
  let text;
  if (share >= 0.4 || avg < 6) {
    level = 'rushed';
    text = `Rushed — ${tooFast} of ${answered.length} answers were chosen in under ${TOO_FAST_SECONDS} seconds, too fast to read the question. Treat these results with caution.`;
  } else if (share >= 0.15) {
    level = 'mixed';
    text = `Mostly careful, but ${tooFast} answers were chosen in under ${TOO_FAST_SECONDS} seconds.`;
  } else {
    level = 'careful';
    text = `Careful — took time to read (about ${round(avg)} seconds per question on average).`;
  }
  return { level, text, tooFast, answered: answered.length, avgSeconds: round(avg), actualMinutes: round(actual / 60), suggestedMinutes: round(suggested / 60) };
}

function bestAnswer(bank, no) {
  const q = (bank.questions || []).find((x) => x.no === Number(no));
  if (!q) return null;
  const opt = q.options.find((o) => o.key === q.correct) || {};
  return { letter: q.correct, text: opt.en || '', acceptable: [...(q.fullCredit || []).filter((l) => l !== q.correct), ...(q.partial || [])] };
}

/** Admin-only question-wise rows enriched with the best answer. */
function withBestAnswers(rows, bank) {
  return rows.map((r) => {
    const b = bestAnswer(bank, r['Question No']);
    return b ? { ...r, 'Best Answer': b.letter, 'Best Answer Text': b.text, 'Also Accepted': b.acceptable.join(', ') } : r;
  });
}

function isValuesRow(r) {
  return /value|priorit/i.test(String(r.Section || ''));
}

/**
 * Summary of one person. `summary` is every submitted person's summary row
 * (used for rank), `rows` this person's question-wise responses.
 */
function individual({ result, rows, summary, bank, exam }) {
  const name = result.name;
  const first = String(name).split(' ')[0];
  const ranked = [...summary].sort((a, b) => (Number(b['Total Score %']) || 0) - (Number(a['Total Score %']) || 0));
  const rank = ranked.findIndex((s) => s.Name === name && Number(s['Total Score %']) === result.totalPct) + 1;
  const posture = scoring.behaviourPosture(rows, exam);
  const eng = engagement(rows, exam);

  const kRows = rows.filter((r) => r.Type === 'KNOWLEDGE');
  const wrongTopics = [...new Set(kRows.filter((r) => r['Correct Y/N'] !== 'Y').map((r) => r.Category))];
  const rightTopics = [...new Set(kRows.filter((r) => r['Correct Y/N'] === 'Y').map((r) => r.Category))];
  const valuesRows = rows.filter(isValuesRow);
  const valueDims = new Set(valuesRows.map((r) => r.Dimension).filter(Boolean));
  const dims = result.dimensions || [];
  const values = dims.filter((d) => valueDims.has(d.key));
  const situational = dims.filter((d) => d.group === 'BEHAVIOUR' && !valueDims.has(d.key));
  const strongValues = values.filter((d) => d.pct >= 70).map((d) => d.label);
  const weakValues = values.filter((d) => d.pct < 50).map((d) => d.label);
  const concerns = (posture && posture.concerns) || [];

  const answers = [];
  answers.push({
    q: 'How did they do overall?',
    a: `${result.totalPct}% (${result.correct} of ${result.total} points) — ${label(result.totalPct)}.${rank ? ` Ranked ${rank} of ${summary.length} so far.` : ''}`,
  });
  if (kRows.length) {
    answers.push({
      q: 'Do they know the rules and procedures?',
      a: `Knowledge ${result.knowledgePct}% — ${label(result.knowledgePct)}.${wrongTopics.length ? ` Needs refresher on: ${list(wrongTopics, 4)}.` : ' No gaps found.'}${rightTopics.length && wrongTopics.length ? ` Knows well: ${list(rightTopics, 3)}.` : ''}`,
    });
  }
  if (posture) {
    answers.push({
      q: 'How do they handle difficult situations?',
      a: `${posture.label} — chose the preferred response in ${posture.counts.correct} of ${posture.situations} situations${posture.counts.concern ? ` and a concern response in ${posture.counts.concern}` : ''}.${situational.length ? ` Strongest: ${list([...situational].sort((a, b) => b.pct - a.pct).map((d) => d.label), 2)}.` : ''}${posture.tendencies.length ? ` Tends to: ${list(posture.tendencies, 2).toLowerCase()}.` : ''}`,
    });
  }
  if (values.length) {
    answers.push({
      q: 'Do they show our values (integrity, one team, respect…)?',
      a: `${strongValues.length ? `Shows ${list(strongValues, 3)}.` : 'No value area was clearly strong.'}${weakValues.length ? ` Weak on ${list(weakValues, 3)}.` : ''}`,
    });
  }
  answers.push({ q: 'Did they take the exam seriously?', a: `${eng.text}${result.integrity && result.integrity.tabSwitches ? ` Left the exam tab ${result.integrity.tabSwitches} time(s).` : ''}` });
  answers.push({
    q: 'Anything to worry about?',
    a: concerns.length
      ? `${concerns.length} concern answer(s): ${list(concerns.map((c) => `${c.qid} — ${String(c.interpretation).replace(/^(CRITICAL )?CONCERN:\s*/i, '')}`), 3)}.`
      : 'No concern answers.',
  });

  const actions = [];
  if (eng.level === 'rushed') actions.push('talk to them about the result first — many answers were too fast to be genuine; consider a re-test');
  if (result.knowledgePct !== null && result.knowledgePct < 60 && wrongTopics.length) actions.push(`arrange a refresher on ${list(wrongTopics, 3)}`);
  if (concerns.length >= 2) actions.push('have a one-to-one conversation about the concern answers');
  else if (concerns.length === 1) actions.push(`discuss question ${concerns[0].qid} with them`);
  if (weakValues.length) actions.push(`coach on ${list(weakValues, 2)}`);
  if (!actions.length) actions.push(result.totalPct >= 80 ? 'recognise the result; consider them as a buddy or trainer for others' : 'keep supporting as usual');
  answers.push({ q: 'What should the team lead do next?', a: `${actions.map((x, i) => (i ? x : x[0].toUpperCase() + x.slice(1))).join('; ')}.` });

  // One paragraph.
  const bits = [];
  bits.push(`${first} scored ${result.totalPct}% (${label(result.totalPct)}).`);
  if (kRows.length) bits.push(`Knowledge of the rules is ${label(result.knowledgePct)}${wrongTopics.length ? `, with gaps in ${list(wrongTopics, 3)}` : ''}.`);
  if (posture) bits.push(`In workplace situations the pattern is "${posture.label.toLowerCase()}"${concerns.length ? `, including ${concerns.length} answer(s) that are a concern` : ''}.`);
  if (strongValues.length || weakValues.length) bits.push(`${strongValues.length ? `Values shown: ${list(strongValues, 3)}.` : ''}${weakValues.length ? ` Values to develop: ${list(weakValues, 3)}.` : ''}`.trim());
  bits.push(eng.level === 'rushed' ? 'Answers were given very quickly, so the result may not reflect real ability.' : eng.level === 'mixed' ? 'Some answers were given very quickly.' : 'The exam was taken carefully.');
  const headline = eng.level === 'rushed' ? 'Result unreliable — rushed' : concerns.length >= 3 ? 'Needs attention' : result.totalPct >= 80 ? 'Strong performer' : result.totalPct >= 60 ? 'On track' : 'Needs development';

  return { headline, paragraph: bits.join(' '), answers, engagement: eng, rank, of: summary.length };
}

/** Team-level summary for the Analytics tab. */
function team({ analytics, summary, responses, bank, exam, assigned, reports }) {
  const n = summary.length;
  if (!n) return null;
  const scores = summary.map((s) => ({ name: s.Name, pct: Number(s['Total Score %']) || 0 }));
  const avg = round(scores.reduce((a, b) => a + b.pct, 0) / n);
  const best = [...scores].sort((a, b) => b.pct - a.pct)[0];
  const worst = [...scores].sort((a, b) => a.pct - b.pct)[0];
  const byUser = new Map();
  for (const r of responses) {
    if (!byUser.has(r.Username)) byUser.set(r.Username, []);
    byUser.get(r.Username).push(r);
  }
  const people = summary.map((s) => {
    const rows = byUser.get(s.Username) || [];
    return { name: s.Name, pct: Number(s['Total Score %']) || 0, eng: engagement(rows, exam), posture: scoring.behaviourPosture(rows, exam), tabs: Number(s['Tab Switches']) || 0 };
  });
  const dims = [...(analytics.dimensions || [])].sort((a, b) => b.average - a.average);
  const hardest = [...analytics.questions].sort((a, b) => a.accuracy - b.accuracy).slice(0, 5).map((q) => {
    const b = bestAnswer(bank, q.no);
    return { ...q, best: b };
  });
  const postureCounts = {};
  for (const p of people) if (p.posture) postureCounts[p.posture.label] = (postureCounts[p.posture.label] || 0) + 1;
  const concernTally = new Map();
  for (const c of analytics.concerns || []) {
    const k = `${c.qid || c.no}`;
    const e = concernTally.get(k) || { qid: k, category: c.category, count: 0, interpretation: c.interpretation };
    e.count += 1;
    concernTally.set(k, e);
  }
  const topConcerns = [...concernTally.values()].sort((a, b) => b.count - a.count).slice(0, 3);
  const rushed = people.filter((p) => p.eng.level === 'rushed');
  const tabbers = people.filter((p) => p.tabs >= 3);
  const attention = people
    .map((p) => {
      const why = [];
      if (p.eng.level === 'rushed') why.push('rushed answers');
      if (p.pct < 50) why.push(`low score (${p.pct}%)`);
      if (p.posture && p.posture.counts.concern >= 3) why.push(`${p.posture.counts.concern} concern answers`);
      if (p.tabs >= 3) why.push(`left the exam tab ${p.tabs} times`);
      return why.length ? { name: p.name, why } : null;
    })
    .filter(Boolean);

  const answers = [
    {
      q: 'How did the team do?',
      a: `${n} of ${assigned} people have submitted. Average ${avg}% (${label(avg)}). Highest ${best.name} ${best.pct}%, lowest ${worst.name} ${worst.pct}%.`,
    },
    {
      q: 'Where is the team strong, and where weak?',
      a: dims.length
        ? `Strong: ${list(dims.slice(0, 3).map((d) => `${d.label} (${d.average}%)`), 3)}. Weak: ${list([...dims].reverse().slice(0, 3).map((d) => `${d.label} (${d.average}%)`), 3)}.`
        : 'Not enough data yet.',
    },
    {
      q: 'Which questions did most people get wrong?',
      a: hardest.map((q) => `${q.qid || `Q${q.no}`} ${q.category} — ${q.accuracy}% scored${q.best ? `; correct answer ${q.best.letter}: “${q.best.text}”` : ''}`).join(' | '),
      list: hardest.map((q) => ({ id: q.qid || `Q${q.no}`, category: q.category, accuracy: q.accuracy, best: q.best })),
    },
    {
      q: 'How does the team behave in difficult situations?',
      a: `${Object.entries(postureCounts).map(([k, v]) => `${v} × ${k}`).join(', ') || 'No behaviour data.'}${topConcerns.length ? `. Most common concern answers: ${list(topConcerns.map((c) => `${c.qid} ${c.category} (${c.count} people)`), 3)}.` : ''}`,
    },
    {
      q: 'Did people take it seriously?',
      a: `${rushed.length ? `${rushed.length} person(s) rushed (${list(rushed.map((p) => p.name), 5)}) — their results are unreliable.` : 'Nobody rushed.'} ${tabbers.length ? `${tabbers.length} left the exam tab 3+ times (${list(tabbers.map((p) => p.name), 5)}).` : 'No repeated tab switching.'}`,
    },
    {
      q: 'Who needs attention?',
      a: attention.length ? attention.map((x) => `${x.name}: ${x.why.join(', ')}`).join(' | ') : 'Nobody stands out.',
    },
    {
      q: 'Were any questions reported as wrong?',
      a: reports.length ? `${reports.length} report(s) — see the Reports tab.` : 'No reports.',
    },
  ];
  const paragraph = [
    `${n} of ${assigned} people have taken the assessment, averaging ${avg}%.`,
    dims.length ? `The team is strongest in ${list(dims.slice(0, 2).map((d) => d.label), 2)} and weakest in ${list([...dims].reverse().slice(0, 2).map((d) => d.label), 2)}.` : '',
    hardest.length ? `The question most people got wrong was ${hardest[0].qid || `Q${hardest[0].no}`} (${hardest[0].category}).` : '',
    topConcerns.length ? `The most common concern answer was on ${topConcerns[0].category}.` : '',
    rushed.length ? `${rushed.length} result(s) should be treated with caution because answers were rushed.` : '',
    attention.length ? `${attention.length} person(s) need follow-up.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { paragraph, answers };
}

module.exports = { individual, team, engagement, withBestAnswers, TOO_FAST_SECONDS };
