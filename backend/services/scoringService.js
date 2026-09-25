/**
 * Server-side scoring, remarks and analytics. The answer key is only ever read
 * here — nothing in this file returns correct options to a participant.
 */
const { computeTimings, formatDuration } = require('./timerService');

const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';

const REMARKS = {
  outstanding: {
    en: 'You nailed it! Outstanding performance across both sections.',
    hi: 'शानदार! दोनों खंडों में आपका प्रदर्शन उत्कृष्ट रहा।',
  },
  greatKnowledge: {
    en: 'Great work! Your regulatory knowledge is strong. Keep building on your behavioural judgment.',
    hi: 'बहुत बढ़िया! आपका नियामक ज्ञान मज़बूत है। अपने व्यवहारिक निर्णय को और निखारते रहें।',
  },
  wellDoneBehaviour: {
    en: 'Well done! Your approach to situations is commendable. Continue strengthening your knowledge base.',
    hi: 'बहुत अच्छा! परिस्थितियों को संभालने का आपका तरीका सराहनीय है। अपने ज्ञान को और मज़बूत करते रहें।',
  },
  solid: {
    en: 'Good work! Keep strengthening both your knowledge and your behavioural judgment.',
    hi: 'अच्छा काम! अपने ज्ञान और व्यवहारिक निर्णय — दोनों को मज़बूत करते रहें।',
  },
  goodEffort: {
    en: 'Good effort. Based on this assessment, your knowledge foundation is developing — focus on the areas flagged during your exam.',
    hi: 'अच्छा प्रयास। इस आकलन के आधार पर आपकी ज्ञान की नींव विकसित हो रही है — परीक्षा के दौरान चिह्नित किए गए विषयों पर ध्यान दें।',
  },
  growth: {
    en: 'Thank you for participating. There is strong room for growth — speak with your team lead about a learning plan.',
    hi: 'भाग लेने के लिए धन्यवाद। सुधार की अच्छी संभावना है — सीखने की योजना के लिए अपने टीम लीड से बात करें।',
  },
  gapKnowledge: {
    en: 'Your regulatory knowledge is solid. Your next growth area is behavioural judgment in complex situations.',
    hi: 'आपका नियामक ज्ञान ठोस है। जटिल परिस्थितियों में व्यवहारिक निर्णय आपके विकास का अगला क्षेत्र है।',
  },
  gapBehaviour: {
    en: 'You handle situations well. Strengthen your regulatory and process knowledge to complement this.',
    hi: 'आप परिस्थितियों को अच्छी तरह संभालते हैं। इसके साथ अपने नियामक और प्रक्रिया ज्ञान को भी मज़बूत करें।',
  },
};

function pct(correct, total) {
  return total ? Math.round((correct / total) * 1000) / 10 : 0;
}

/** Remark keys (in display order) for the given percentages and thresholds. */
function remarkKeys(totalPct, knowledgePct, behaviourPct, th) {
  if (totalPct >= th.excellent) return ['outstanding'];
  const keys = [];
  const hasK = knowledgePct !== null && knowledgePct !== undefined;
  const hasB = behaviourPct !== null && behaviourPct !== undefined;
  if (totalPct >= th.good) {
    const kOk = hasK && knowledgePct >= th.knowledge;
    const bOk = hasB && behaviourPct >= th.behaviour;
    if (kOk && (!bOk || knowledgePct >= behaviourPct)) keys.push('greatKnowledge');
    else if (bOk) keys.push('wellDoneBehaviour');
    else keys.push('solid');
  } else if (totalPct >= th.fair) {
    keys.push('goodEffort');
  } else {
    keys.push('growth');
  }
  if (hasK && hasB) {
    if (knowledgePct - behaviourPct >= th.gap) keys.push('gapKnowledge');
    else if (behaviourPct - knowledgePct >= th.gap) keys.push('gapBehaviour');
  }
  return keys;
}

function remarks(totalPct, knowledgePct, behaviourPct, th) {
  return remarkKeys(totalPct, knowledgePct, behaviourPct, th).map((k) => ({ key: k, ...REMARKS[k] }));
}

function remarksText(list) {
  return list.map((r) => r.en).join(' ');
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace('T', ' ');
}

function formatDate(value) {
  return formatDateTime(value).slice(0, 10);
}

function unlockDate(submittedAt, days) {
  return new Date(new Date(submittedAt).getTime() + Number(days || 0) * 86400000).toISOString();
}

/**
 * Score a finished attempt.
 * @returns {{ result, summaryRow, responseRows }}
 */
function scoreAttempt({ exam, bank, user, attempt }) {
  const timings = computeTimings(bank, attempt.state, attempt.startedAt, attempt.submittedAt);
  const typeTally = {};
  const sectionTally = new Map(bank.sections.map((s) => [s.no, { correct: 0, total: 0 }]));
  let correct = 0;
  let answered = 0;
  let flagged = 0;
  const responseRows = [];

  for (const q of bank.questions) {
    const t = timings.perQuestion.get(q.no);
    const isCorrect = !!t.answer && t.answer === q.correct;
    if (t.answer) answered += 1;
    if (t.flagged) flagged += 1;
    if (isCorrect) correct += 1;
    const sec = sectionTally.get(q.sectionNo) || { correct: 0, total: 0 };
    sec.total += 1;
    if (isCorrect) sec.correct += 1;
    sectionTally.set(q.sectionNo, sec);
    if (q.type) {
      typeTally[q.type] = typeTally[q.type] || { correct: 0, total: 0 };
      typeTally[q.type].total += 1;
      if (isCorrect) typeTally[q.type].correct += 1;
    }
    const section = bank.sections.find((s) => s.no === q.sectionNo);
    responseRows.push({
      'Participant Name': user.name,
      Username: user.username,
      'Question No': q.no,
      Section: section ? `Section ${section.no} — ${section.name}` : `Section ${q.sectionNo}`,
      Type: q.type,
      Category: q.category,
      'Question Text (EN)': q.textEn,
      'Option Selected': t.answer || '—',
      'Time on Question (seconds)': t.seconds,
      'Active Time on Question (seconds)': t.activeSeconds,
      'Times Changed': t.changes,
      'Flagged Y/N': t.flagged ? 'Y' : 'N',
      'Correct Y/N': isCorrect ? 'Y' : 'N',
    });
  }

  const total = bank.questions.length;
  const totalPct = pct(correct, total);
  const sectionsResult = bank.sections.map((s) => {
    const tally = sectionTally.get(s.no) || { correct: 0, total: 0 };
    return {
      no: s.no,
      name: s.name,
      nameHi: s.nameHi,
      correct: tally.correct,
      total: tally.total,
      pct: pct(tally.correct, tally.total),
      seconds: timings.perSection.get(s.no) || 0,
    };
  });
  // Knowledge / Behaviour split uses the question type tag; fall back to
  // section 1 / section 2 if the tags were not filled in.
  const byType = (type, fallbackIdx) => {
    if (typeTally[type]) return pct(typeTally[type].correct, typeTally[type].total);
    const s = sectionsResult[fallbackIdx];
    return s && s.total ? s.pct : null;
  };
  const knowledgePct = byType('KNOWLEDGE', 0);
  const behaviourPct = byType('BEHAVIOUR', 1);
  const unlockAt = unlockDate(attempt.submittedAt, exam.unlockDays);
  const remarkList = remarks(totalPct, knowledgePct, behaviourPct, exam.thresholds);

  const summaryRow = {
    Name: user.name,
    Username: user.username,
    'Exam Title': exam.title,
    Team: exam.team,
    Site: exam.site,
    'Start Time': formatDateTime(attempt.startedAt),
    'End Time': formatDateTime(attempt.submittedAt),
    'Total Time': formatDuration(timings.totalSeconds),
  };
  for (const s of sectionsResult) summaryRow[`Section ${s.no} Time`] = formatDuration(s.seconds);
  Object.assign(summaryRow, {
    'Total Questions': total,
    Answered: answered,
    Unanswered: total - answered,
    Flagged: flagged,
  });
  for (const s of sectionsResult) summaryRow[`Section ${s.no} Score %`] = s.pct;
  Object.assign(summaryRow, {
    'Total Score %': totalPct,
    Remarks: remarksText(remarkList),
    'Result Unlock Date': formatDate(unlockAt),
    'Submitted On': formatDateTime(attempt.submittedAt),
    'Correct Answers': correct,
    'Knowledge %': knowledgePct ?? '',
    'Behaviour %': behaviourPct ?? '',
    'Time on Flagged Questions': formatDuration(timings.flaggedSeconds),
    'Total Seconds': timings.totalSeconds,
  });

  const result = {
    name: user.name,
    correct,
    total,
    totalPct,
    answered,
    flagged,
    sections: sectionsResult,
    knowledgePct,
    behaviourPct,
    totalSeconds: timings.totalSeconds,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    unlockAt,
  };
  return { result, summaryRow, responseRows };
}

/** Recompute the Remarks column after thresholds change. */
function refreshRemarks(summaryRows, thresholds) {
  return summaryRows.map((r) => {
    const k = r['Knowledge %'] === '' ? null : Number(r['Knowledge %']);
    const b = r['Behaviour %'] === '' ? null : Number(r['Behaviour %']);
    return { ...r, Remarks: remarksText(remarks(Number(r['Total Score %']) || 0, k, b, thresholds)) };
  });
}

// ---------------------------------------------------------------- analytics

function avg(list) {
  return list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : 0;
}

function computeAnalytics(summary, responses) {
  const perQuestion = new Map();
  for (const r of responses) {
    const no = Number(r['Question No']);
    if (!perQuestion.has(no)) {
      perQuestion.set(no, {
        no,
        section: r.Section,
        category: r.Category,
        text: r['Question Text (EN)'],
        attempts: 0,
        answered: 0,
        correct: 0,
        flagged: 0,
        times: [],
        changes: [],
      });
    }
    const q = perQuestion.get(no);
    q.attempts += 1;
    if (r['Option Selected'] && r['Option Selected'] !== '—') q.answered += 1;
    if (r['Correct Y/N'] === 'Y') q.correct += 1;
    if (r['Flagged Y/N'] === 'Y') q.flagged += 1;
    q.times.push(Number(r['Active Time on Question (seconds)'] ?? r['Time on Question (seconds)']) || 0);
    q.changes.push(Number(r['Times Changed']) || 0);
  }
  const questions = [...perQuestion.values()]
    .sort((a, b) => a.no - b.no)
    .map((q) => ({
      no: q.no,
      section: q.section,
      category: q.category,
      text: q.text,
      attempts: q.attempts,
      correct: q.correct,
      accuracy: pct(q.correct, q.attempts),
      flagged: q.flagged,
      avgTime: avg(q.times),
      avgChanges: avg(q.changes),
    }));

  const sectionKeys = Object.keys(summary[0] || {}).filter((k) => /^Section \d+ Score %$/.test(k));
  const sectionNames = new Map();
  for (const q of questions) {
    const m = /^Section (\d+)/.exec(q.section || '');
    if (m) sectionNames.set(`Section ${m[1]} Score %`, q.section);
  }
  const sections = sectionKeys.map((k) => {
    const vals = summary.map((r) => Number(r[k]) || 0);
    return {
      key: k,
      name: sectionNames.get(k) || k.replace(' Score %', ''),
      average: avg(vals),
      highest: vals.length ? Math.max(...vals) : 0,
      lowest: vals.length ? Math.min(...vals) : 0,
    };
  });

  const ranking = [...summary]
    .sort(
      (a, b) =>
        (Number(b['Total Score %']) || 0) - (Number(a['Total Score %']) || 0) ||
        (Number(a['Total Seconds']) || 0) - (Number(b['Total Seconds']) || 0),
    )
    .map((r, i) => ({
      rank: i + 1,
      name: r.Name,
      username: r.Username,
      totalPct: Number(r['Total Score %']) || 0,
      totalTime: r['Total Time'],
      totalSeconds: Number(r['Total Seconds']) || 0,
    }));

  const buckets = ['0-9', '10-19', '20-29', '30-39', '40-49', '50-59', '60-69', '70-79', '80-89', '90-100'].map(
    (label) => ({ label, count: 0 }),
  );
  for (const r of ranking) buckets[Math.min(9, Math.floor(r.totalPct / 10))].count += 1;

  const timeBuckets = [];
  if (ranking.length) {
    const mins = ranking.map((r) => r.totalSeconds / 60);
    const max = Math.max(...mins);
    const step = max <= 10 ? 2 : max <= 30 ? 5 : max <= 90 ? 10 : 20;
    for (let lo = 0; lo <= max; lo += step) {
      timeBuckets.push({ label: `${lo}-${lo + step} min`, count: mins.filter((m) => m >= lo && m < lo + step).length });
    }
  }

  return {
    participants: summary.length,
    averageScore: avg(summary.map((r) => Number(r['Total Score %']) || 0)),
    averageSeconds: Math.round(avg(summary.map((r) => Number(r['Total Seconds']) || 0))),
    questions,
    mostFlagged: [...questions].filter((q) => q.flagged).sort((a, b) => b.flagged - a.flagged).slice(0, 10),
    hardest: [...questions].sort((a, b) => a.accuracy - b.accuracy).slice(0, 10),
    sections,
    ranking,
    scoreDistribution: buckets,
    timeDistribution: timeBuckets,
  };
}

/** Array-of-arrays layout for the "Analytics" sheet. */
function buildAnalyticsSheet(summary, responses) {
  const a = computeAnalytics(summary, responses);
  const aoa = [
    ['Analytics', `Generated ${formatDateTime(new Date())}`],
    ['Participants', a.participants],
    ['Average Total Score %', a.averageScore],
    ['Average Total Time', formatDuration(a.averageSeconds)],
    [],
    ['QUESTION-WISE PERFORMANCE'],
    ['Question No', 'Section', 'Category', 'Attempts', 'Correct', 'Average Score %', 'Times Flagged', 'Avg Time (s)', 'Avg Changes'],
    ...a.questions.map((q) => [q.no, q.section, q.category, q.attempts, q.correct, q.accuracy, q.flagged, q.avgTime, q.avgChanges]),
    [],
    ['MOST FLAGGED QUESTIONS'],
    ['Question No', 'Times Flagged', 'Category', 'Question Text (EN)'],
    ...(a.mostFlagged.length ? a.mostFlagged.map((q) => [q.no, q.flagged, q.category, q.text]) : [['—', 'No flagged questions']]),
    [],
    ['AVERAGE TIME PER QUESTION'],
    ['Question No', 'Avg Time (s)'],
    ...a.questions.map((q) => [q.no, q.avgTime]),
    [],
    ['SECTION-WISE PERFORMANCE'],
    ['Section', 'Average %', 'Highest %', 'Lowest %'],
    ...a.sections.map((s) => [s.name, s.average, s.highest, s.lowest]),
    [],
    ['PARTICIPANT RANK'],
    ['Rank', 'Name', 'Username', 'Total Score %', 'Total Time'],
    ...a.ranking.map((r) => [r.rank, r.name, r.username, r.totalPct, r.totalTime]),
  ];
  return aoa;
}

module.exports = {
  REMARKS,
  remarks,
  remarkKeys,
  scoreAttempt,
  refreshRemarks,
  computeAnalytics,
  buildAnalyticsSheet,
  formatDateTime,
  formatDate,
  unlockDate,
};
