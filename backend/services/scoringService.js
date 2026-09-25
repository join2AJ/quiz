/**
 * Server-side scoring, remarks and analytics. The answer key (and the
 * behaviour interpretation / reveal map) is only ever read here and in admin
 * routes — nothing in this file returns it to a participant.
 *
 * Scoring model (per question, weight w, default 1):
 *   full-credit option (correct / preferred)  -> w points
 *   partial-credit option (acceptable)         -> w × partialCreditPct%
 *   concern / neutral / other / unanswered     -> 0
 * Section, Knowledge, Behaviour, dimension and total % = points ÷ max points.
 */
const { computeTimings, formatDuration } = require('./timerService');
const rules = require('./ruleEngine');

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

const KIND_LABEL = {
  correct: 'Correct / Preferred',
  acceptable: 'Acceptable (partial)',
  concern: 'Concern',
  neutral: 'Neutral',
  incorrect: 'Incorrect',
  unanswered: 'Unanswered',
};

const round1 = (n) => Math.round(n * 10) / 10;

function pct(earned, max) {
  return max ? round1((earned / max) * 100) : 0;
}

function prettyKey(key) {
  return String(key || '')
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function dimensionLabel(exam, key) {
  const d = ((exam && exam.config && exam.config.dimensions) || {})[key] || {};
  return { label: d.label || prettyKey(key), labelHi: d.labelHi || '' };
}

function partialFraction(exam) {
  const p = Number(exam && exam.config && exam.config.partialCreditPct);
  return Number.isFinite(p) ? Math.min(100, Math.max(0, p)) / 100 : 0.5;
}

/** How an answer scores: { credit 0..1, kind }. */
function creditFor(q, answer, partial) {
  if (!answer) return { credit: 0, kind: 'unanswered' };
  const full = q.fullCredit && q.fullCredit.length ? q.fullCredit : [q.correct];
  if (full.includes(answer)) return { credit: 1, kind: 'correct' };
  if ((q.partial || []).includes(answer)) return { credit: partial, kind: 'acceptable' };
  if ((q.concern || []).includes(answer)) return { credit: 0, kind: 'concern' };
  if ((q.neutral || []).includes(answer)) return { credit: 0, kind: 'neutral' };
  return { credit: 0, kind: 'incorrect' };
}

// ---------------------------------------------------------------- remarks

/** Variables available to remark conditions. */
const BASE_VARS = ['total_pct', 'knowledge_pct', 'behaviour_pct'];
function isAllowedVar(v) {
  return BASE_VARS.includes(v) || /^section_\d+_pct$/.test(v) || /^dim_[a-z0-9_]+_pct$/.test(v);
}

function remarkVars(r) {
  const vars = { total_pct: r.totalPct, knowledge_pct: r.knowledgePct, behaviour_pct: r.behaviourPct };
  for (const s of r.sections || []) vars[`section_${s.no}_pct`] = s.pct;
  for (const d of r.dimensions || []) vars[`dim_${d.key}_pct`] = d.pct;
  return vars;
}

function builtInRemarkKeys(totalPct, knowledgePct, behaviourPct, th) {
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

/**
 * Remarks for a result. If the exam has custom remark rules they are
 * evaluated in order and the first match wins; otherwise the built-in
 * threshold logic is used.
 */
function remarksFor(r, exam) {
  const custom = exam && exam.config && Array.isArray(exam.config.remarkRules) ? exam.config.remarkRules : [];
  if (custom.length) {
    const vars = remarkVars(r);
    for (let i = 0; i < custom.length; i += 1) {
      let hit = false;
      try {
        hit = rules.evaluate(custom[i].condition, vars);
      } catch {
        hit = false;
      }
      if (hit) return [{ key: `rule-${i + 1}`, en: custom[i].en || '', hi: custom[i].hi || '' }];
    }
    return [];
  }
  return builtInRemarkKeys(r.totalPct, r.knowledgePct, r.behaviourPct, exam.thresholds).map((k) => ({ key: k, ...REMARKS[k] }));
}

function remarksText(list) {
  return list.map((r) => r.en).join(' ');
}

/** Validate custom remark rules; returns an error message or null. */
function validateRemarkRules(list) {
  for (const [i, r] of list.entries()) {
    const err = rules.validate(r.condition, isAllowedVar);
    if (err) return `Remark rule ${i + 1} ("${r.condition}"): ${err}`;
    if (!String(r.en || '').trim()) return `Remark rule ${i + 1} needs an English remark`;
  }
  return null;
}

// ---------------------------------------------------------------- formatting

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

// ---------------------------------------------------------------- scoring

function tally() {
  return { earned: 0, max: 0, correct: 0, count: 0 };
}

/**
 * Score a finished attempt.
 * @returns {{ result, summaryRow, responseRows }}
 */
function scoreAttempt({ exam, bank, user, attempt }) {
  const timings = computeTimings(bank, attempt.state, attempt.startedAt, attempt.submittedAt);
  const partial = partialFraction(exam);
  const overall = tally();
  const bySection = new Map(bank.sections.map((s) => [s.no, tally()]));
  const byType = {};
  const byDim = new Map();
  let answered = 0;
  let flagged = 0;
  let concerns = 0;
  let changes = 0;
  const responseRows = [];

  for (const q of bank.questions) {
    const t = timings.perQuestion.get(q.no);
    const w = Number(q.weight) > 0 ? Number(q.weight) : 1;
    const { credit, kind } = creditFor(q, t.answer, partial);
    const points = credit * w;
    if (t.answer) answered += 1;
    if (t.flagged) flagged += 1;
    if (kind === 'concern') concerns += 1;
    changes += t.changes;
    const add = (tl) => {
      tl.earned += points;
      tl.max += w;
      tl.count += 1;
      if (credit === 1) tl.correct += 1;
    };
    add(overall);
    if (!bySection.has(q.sectionNo)) bySection.set(q.sectionNo, tally());
    add(bySection.get(q.sectionNo));
    if (q.type) add((byType[q.type] = byType[q.type] || tally()));
    if (q.dimension) {
      if (!byDim.has(q.dimension)) byDim.set(q.dimension, { ...tally(), type: q.type });
      add(byDim.get(q.dimension));
    }
    const section = bank.sections.find((s) => s.no === q.sectionNo);
    responseRows.push({
      'Participant Name': user.name,
      Username: user.username,
      'Question No': q.no,
      QID: q.qid,
      Section: section ? `Section ${section.no} — ${section.name}` : `Section ${q.sectionNo}`,
      Type: q.type,
      Category: q.category,
      Dimension: q.dimension || '',
      'Question Text (EN)': q.textEn,
      'Option Selected': t.answer || '—',
      'Time on Question (seconds)': t.seconds,
      'Active Time on Question (seconds)': t.activeSeconds,
      'Times Changed': t.changes,
      'Flagged Y/N': t.flagged ? 'Y' : 'N',
      'Correct Y/N': credit === 1 ? 'Y' : 'N',
      Credit: round1(credit * 100) / 100,
      Weight: w,
      Points: round1(points),
      'Response Type': KIND_LABEL[kind],
      Interpretation: t.answer ? (q.revealMap || {})[t.answer] || '' : '',
    });
  }

  const sectionsResult = bank.sections.map((s) => {
    const tl = bySection.get(s.no) || tally();
    return {
      no: s.no,
      name: s.name,
      nameHi: s.nameHi,
      correct: round1(tl.earned),
      total: tl.max,
      pct: pct(tl.earned, tl.max),
      seconds: timings.perSection.get(s.no) || 0,
    };
  });
  // Knowledge / Behaviour use the question type tag; fall back to sections 1 / 2.
  const typePct = (type, fallbackIdx) => {
    if (byType[type]) return pct(byType[type].earned, byType[type].max);
    const s = sectionsResult[fallbackIdx];
    return s && s.total ? s.pct : null;
  };
  const knowledgePct = typePct('KNOWLEDGE', 0);
  const behaviourPct = typePct('BEHAVIOUR', 1);
  const dimensions = [...byDim.entries()].map(([key, tl]) => ({
    key,
    ...dimensionLabel(exam, key),
    group: tl.type || '',
    pct: pct(tl.earned, tl.max),
    earned: round1(tl.earned),
    max: tl.max,
  }));
  const totalPct = pct(overall.earned, overall.max);
  const unlockAt = unlockDate(attempt.submittedAt, exam.unlockDays);
  const st = attempt.state || {};
  const integrity = {
    tabSwitches: st.tabHidden || 0,
    hiddenSeconds: Math.round((st.hiddenMs || 0) / 1000),
    languageToggles: st.langToggles || 0,
    answerChanges: changes,
  };

  const result = {
    name: user.name,
    nameHi: user.nameHi || '',
    correct: round1(overall.earned),
    total: overall.max,
    correctCount: overall.correct,
    questionCount: bank.questions.length,
    totalPct,
    answered,
    flagged,
    sections: sectionsResult,
    knowledgePct,
    behaviourPct,
    dimensions,
    concernCount: concerns,
    integrity,
    totalSeconds: timings.totalSeconds,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    unlockAt,
  };
  const remarkList = remarksFor(result, exam);

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
    'Total Questions': bank.questions.length,
    Answered: answered,
    Unanswered: bank.questions.length - answered,
    Flagged: flagged,
  });
  for (const s of sectionsResult) summaryRow[`Section ${s.no} Score %`] = s.pct;
  Object.assign(summaryRow, {
    'Total Score %': totalPct,
    Remarks: remarksText(remarkList),
    'Result Unlock Date': formatDate(unlockAt),
    'Submitted On': formatDateTime(attempt.submittedAt),
    'Correct Answers': overall.correct,
    Points: round1(overall.earned),
    'Max Points': overall.max,
    'Knowledge %': knowledgePct ?? '',
    'Behaviour %': behaviourPct ?? '',
  });
  for (const d of dimensions) summaryRow[`${d.label} %`] = d.pct;
  Object.assign(summaryRow, {
    'Concern Answers': concerns,
    'Answer Changes': integrity.answerChanges,
    'Tab Switches': integrity.tabSwitches,
    'Time Away From Exam Tab': formatDuration(integrity.hiddenSeconds),
    'Language Toggles': integrity.languageToggles,
    'Time on Flagged Questions': formatDuration(timings.flaggedSeconds),
    Designation: user.designation || '',
    Post: user.post || '',
    Shift: user.shift || '',
    'Total Seconds': timings.totalSeconds,
    'Dimension Scores': JSON.stringify(Object.fromEntries(dimensions.map((d) => [d.key, d.pct]))),
  });

  return { result, summaryRow, responseRows };
}

/** Recompute the Remarks column (after thresholds / remark rules change). */
function refreshRemarks(summaryRows, exam) {
  return summaryRows.map((r) => {
    const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
    const sections = Object.keys(r)
      .map((k) => /^Section (\d+) Score %$/.exec(k))
      .filter(Boolean)
      .map((m) => ({ no: Number(m[1]), pct: num(r[m[0]]) }));
    let dims = {};
    try {
      dims = JSON.parse(r['Dimension Scores'] || '{}');
    } catch {
      dims = {};
    }
    const res = {
      totalPct: num(r['Total Score %']) || 0,
      knowledgePct: num(r['Knowledge %']),
      behaviourPct: num(r['Behaviour %']),
      sections,
      dimensions: Object.entries(dims).map(([key, p]) => ({ key, pct: p })),
    };
    return { ...r, Remarks: remarksText(remarksFor(res, exam)) };
  });
}

// ---------------------------------------------------------------- analytics

function avg(list) {
  return list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : 0;
}

// ---------------------------------------------------------------- behaviour posture

const KIND_FROM_LABEL = Object.fromEntries(Object.entries(KIND_LABEL).map(([k, v]) => [v, k]));

/** "CONCERN: makes a false promise — integrity gap" -> "makes a false promise" */
function trait(interpretation) {
  const t = String(interpretation || '')
    .replace(/^(CONCERN|PREFERRED|ACCEPTABLE|NEUTRAL)\s*:\s*/i, '')
    .split(/\s+[—–-]\s+/)[0]
    .trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/**
 * Behaviour posture of one participant, from their question-wise responses:
 * how often they chose the preferred / acceptable / neutral / concern
 * response, per-dimension alignment, strengths, development areas and the
 * tendencies their non-preferred answers reveal. Admin only.
 */
function behaviourPosture(rows, exam) {
  const beh = rows.filter((r) => r.Type === 'BEHAVIOUR' || (r.Interpretation && r.Type !== 'KNOWLEDGE'));
  if (!beh.length) return null;
  const counts = { correct: 0, acceptable: 0, neutral: 0, concern: 0, incorrect: 0, unanswered: 0 };
  const dims = new Map();
  const traits = new Map();
  const concernItems = [];
  let earned = 0;
  let max = 0;
  for (const r of beh) {
    const kind = KIND_FROM_LABEL[r['Response Type']] || (r['Option Selected'] === '—' ? 'unanswered' : r['Correct Y/N'] === 'Y' ? 'correct' : 'incorrect');
    counts[kind] = (counts[kind] || 0) + 1;
    const w = Number(r.Weight) || 1;
    const credit = r.Credit !== undefined && r.Credit !== '' ? Number(r.Credit) : kind === 'correct' ? 1 : 0;
    earned += credit * w;
    max += w;
    if (r.Dimension) {
      const d = dims.get(r.Dimension) || { earned: 0, max: 0 };
      d.earned += credit * w;
      d.max += w;
      dims.set(r.Dimension, d);
    }
    if (kind !== 'correct' && kind !== 'unanswered') {
      const t = trait(r.Interpretation);
      if (t) traits.set(t, (traits.get(t) || 0) + 1);
    }
    if (kind === 'concern') {
      concernItems.push({ qid: r.QID || String(r['Question No']), category: r.Category, option: r['Option Selected'], interpretation: r.Interpretation || '' });
    }
  }
  const alignment = pct(earned, max);
  const dimensions = [...dims.entries()]
    .map(([key, d]) => ({ key, ...dimensionLabel(exam, key), pct: pct(d.earned, d.max) }))
    .sort((a, b) => b.pct - a.pct);
  const strengths = dimensions.filter((d) => d.pct >= 70).slice(0, 3).map((d) => d.label);
  const development = [...dimensions].reverse().filter((d) => d.pct < 60).slice(0, 3).map((d) => d.label);
  const tendencies = [...traits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => (n > 1 ? `${t} (×${n})` : t));

  let label;
  let level;
  if (counts.concern >= 3) [label, level] = ['Needs attention — repeated concern responses', 'concern'];
  else if (alignment >= 75 && counts.concern === 0) [label, level] = ['Strong and consistent', 'strong'];
  else if (alignment >= 60 && counts.concern <= 1) [label, level] = ['Generally sound', 'sound'];
  else if (alignment >= 40) [label, level] = ['Developing', 'developing'];
  else [label, level] = ['Needs guidance', 'concern'];

  const parts = [`${label}: chose the preferred response in ${counts.correct} of ${beh.length} situations`];
  if (counts.acceptable) parts.push(`an acceptable one in ${counts.acceptable}`);
  if (counts.concern) parts.push(`a concern response in ${counts.concern}`);
  let summary = `${parts.join(', ')} (alignment ${alignment}%).`;
  if (strengths.length) summary += ` Strongest in ${strengths.join(', ')}.`;
  if (development.length) summary += ` Develop: ${development.join(', ')}.`;
  if (tendencies.length) summary += ` Tendencies seen: ${tendencies.slice(0, 2).join('; ')}.`;

  return { label, level, alignment, situations: beh.length, counts, dimensions, strengths, development, tendencies, concerns: concernItems, summary };
}

function computeAnalytics(summary, responses, bank, exam) {
  const qByNo = new Map(((bank && bank.questions) || []).map((q) => [q.no, q]));
  const perQuestion = new Map();
  const concerns = [];
  const dimTotals = new Map();
  for (const r of responses) {
    const no = Number(r['Question No']);
    if (!perQuestion.has(no)) {
      perQuestion.set(no, {
        no,
        qid: r.QID || '',
        section: r.Section,
        type: r.Type,
        category: r.Category,
        dimension: r.Dimension || '',
        text: r['Question Text (EN)'],
        attempts: 0,
        credits: [],
        correct: 0,
        flagged: 0,
        times: [],
        changes: [],
        options: { A: 0, B: 0, C: 0, D: 0, '—': 0 },
      });
    }
    const q = perQuestion.get(no);
    q.attempts += 1;
    const credit = r.Credit !== undefined && r.Credit !== '' ? Number(r.Credit) : r['Correct Y/N'] === 'Y' ? 1 : 0;
    q.credits.push(credit);
    if (r['Correct Y/N'] === 'Y') q.correct += 1;
    if (r['Flagged Y/N'] === 'Y') q.flagged += 1;
    q.times.push(Number(r['Active Time on Question (seconds)'] ?? r['Time on Question (seconds)']) || 0);
    q.changes.push(Number(r['Times Changed']) || 0);
    const opt = r['Option Selected'] || '—';
    q.options[opt] = (q.options[opt] || 0) + 1;
    if (r['Response Type'] === KIND_LABEL.concern) {
      concerns.push({
        name: r['Participant Name'],
        username: r.Username,
        no,
        qid: r.QID || '',
        category: r.Category,
        option: opt,
        interpretation: r.Interpretation || '',
      });
    }
    if (r.Dimension) {
      const w = Number(r.Weight) || 1;
      const d = dimTotals.get(r.Dimension) || { earned: 0, max: 0, type: r.Type };
      d.earned += credit * w;
      d.max += w;
      dimTotals.set(r.Dimension, d);
    }
  }

  const questions = [...perQuestion.values()]
    .sort((a, b) => a.no - b.no)
    .map((q) => ({
      no: q.no,
      qid: q.qid,
      section: q.section,
      type: q.type,
      category: q.category,
      dimension: q.dimension,
      text: q.text,
      attempts: q.attempts,
      correct: q.correct,
      accuracy: round1(avg(q.credits) * 100),
      flagged: q.flagged,
      avgTime: avg(q.times),
      avgChanges: avg(q.changes),
      options: q.options,
    }));

  // Behaviour response distribution with the admin-only interpretation of each option.
  const behaviour = questions
    .filter((q) => {
      const bq = qByNo.get(q.no);
      return (bq && Object.keys(bq.revealMap || {}).length) || q.type === 'BEHAVIOUR';
    })
    .map((q) => {
      const bq = qByNo.get(q.no) || {};
      const partial = partialFraction(exam);
      return {
        no: q.no,
        qid: q.qid,
        category: q.category,
        dimension: q.dimension,
        text: q.text,
        attempts: q.attempts,
        options: ['A', 'B', 'C', 'D'].map((o) => ({
          option: o,
          count: q.options[o] || 0,
          kind: bq.correct ? creditFor(bq, o, partial).kind : '',
          interpretation: (bq.revealMap || {})[o] || '',
        })),
        unanswered: q.options['—'] || 0,
      };
    });

  const dimensions = [...dimTotals.entries()].map(([key, d]) => ({
    key,
    ...dimensionLabel(exam, key),
    group: d.type || '',
    average: pct(d.earned, d.max),
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

  const integrity = summary
    .map((r) => ({
      name: r.Name,
      username: r.Username,
      tabSwitches: Number(r['Tab Switches']) || 0,
      timeAway: r['Time Away From Exam Tab'] || '00:00:00',
      answerChanges: Number(r['Answer Changes']) || 0,
      languageToggles: Number(r['Language Toggles']) || 0,
      concerns: Number(r['Concern Answers']) || 0,
    }))
    .sort((a, b) => b.tabSwitches - a.tabSwitches || b.concerns - a.concerns);

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

  // Behaviour posture of each individual.
  const byUser = new Map();
  for (const r of responses) {
    if (!byUser.has(r.Username)) byUser.set(r.Username, []);
    byUser.get(r.Username).push(r);
  }
  const postures = summary
    .map((s) => {
      const p = behaviourPosture(byUser.get(s.Username) || [], exam);
      return p && { name: s.Name, username: s.Username, designation: s.Designation || '', ...p };
    })
    .filter(Boolean)
    .sort((a, b) => a.alignment - b.alignment);

  // Performance by tag (a question can carry several tags).
  const tagStats = new Map();
  for (const q of (bank && bank.questions) || []) {
    const stat = questions.find((x) => x.no === q.no);
    for (const t of q.tags || []) {
      const e = tagStats.get(t) || { tag: t, questions: [], scores: [] };
      e.questions.push(q.qid || `Q${q.no}`);
      if (stat) e.scores.push(stat.accuracy);
      tagStats.set(t, e);
    }
  }
  const tags = [...tagStats.values()]
    .map((t) => ({ tag: t.tag, questions: t.questions, average: t.scores.length ? avg(t.scores) : null }))
    .sort((a, b) => b.questions.length - a.questions.length || a.tag.localeCompare(b.tag));

  return {
    participants: summary.length,
    postures,
    tags,
    averageScore: avg(summary.map((r) => Number(r['Total Score %']) || 0)),
    averageSeconds: Math.round(avg(summary.map((r) => Number(r['Total Seconds']) || 0))),
    questions,
    mostFlagged: [...questions].filter((q) => q.flagged).sort((a, b) => b.flagged - a.flagged).slice(0, 10),
    hardest: [...questions].sort((a, b) => a.accuracy - b.accuracy).slice(0, 10),
    sections,
    dimensions,
    behaviour,
    concerns,
    integrity,
    ranking,
    scoreDistribution: buckets,
    timeDistribution: timeBuckets,
  };
}

/** Array-of-arrays layout for the "Analytics" sheet. */
function buildAnalyticsSheet(summary, responses, bank, exam) {
  const a = computeAnalytics(summary, responses, bank, exam);
  const aoa = [
    ['Analytics', `Generated ${formatDateTime(new Date())}`],
    ['Participants', a.participants],
    ['Average Total Score %', a.averageScore],
    ['Average Total Time', formatDuration(a.averageSeconds)],
    [],
    ['QUESTION-WISE PERFORMANCE'],
    ['Question No', 'QID', 'Section', 'Category', 'Dimension', 'Attempts', 'Full Credit', 'Average Score %', 'Times Flagged', 'Avg Time (s)', 'Avg Changes'],
    ...a.questions.map((q) => [q.no, q.qid, q.section, q.category, q.dimension, q.attempts, q.correct, q.accuracy, q.flagged, q.avgTime, q.avgChanges]),
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
  ];
  if (a.dimensions.length) {
    aoa.push([], ['DIMENSION-WISE PERFORMANCE'], ['Dimension', 'Group', 'Average %'], ...a.dimensions.map((d) => [d.label, d.group, d.average]));
  }
  if (a.postures.length) {
    aoa.push(
      [],
      ['BEHAVIOUR POSTURE BY INDIVIDUAL (admin only)'],
      ['Participant', 'Username', 'Posture', 'Alignment %', 'Preferred', 'Acceptable', 'Neutral', 'Concern', 'Strengths', 'Develop', 'Tendencies', 'Summary'],
      ...a.postures.map((p) => [
        p.name, p.username, p.label, p.alignment, p.counts.correct, p.counts.acceptable, p.counts.neutral, p.counts.concern,
        p.strengths.join(', '), p.development.join(', '), p.tendencies.join('; '), p.summary,
      ]),
    );
  }
  if (a.tags.length) {
    aoa.push([], ['PERFORMANCE BY TAG'], ['Tag', 'Questions', 'Average Score %', 'Question IDs'], ...a.tags.map((t) => [t.tag, t.questions.length, t.average ?? '', t.questions.join(', ')]));
  }
  if (a.behaviour.length) {
    aoa.push([], ['BEHAVIOUR RESPONSE DISTRIBUTION (admin only)'], ['Question No', 'QID', 'Option', 'Count', 'Scored As', 'Interpretation']);
    for (const q of a.behaviour) {
      for (const o of q.options) aoa.push([q.no, q.qid, o.option, o.count, KIND_LABEL[o.kind] || '', o.interpretation]);
    }
  }
  aoa.push(
    [],
    ['CONCERN ANSWERS'],
    ['Participant', 'Username', 'Question No', 'QID', 'Option', 'Interpretation'],
    ...(a.concerns.length ? a.concerns.map((c) => [c.name, c.username, c.no, c.qid, c.option, c.interpretation]) : [['—', 'None']]),
    [],
    ['INTEGRITY SIGNALS'],
    ['Participant', 'Username', 'Tab Switches', 'Time Away', 'Answer Changes', 'Language Toggles', 'Concern Answers'],
    ...a.integrity.map((r) => [r.name, r.username, r.tabSwitches, r.timeAway, r.answerChanges, r.languageToggles, r.concerns]),
    [],
    ['PARTICIPANT RANK'],
    ['Rank', 'Name', 'Username', 'Total Score %', 'Total Time'],
    ...a.ranking.map((r) => [r.rank, r.name, r.username, r.totalPct, r.totalTime]),
  );
  return aoa;
}

module.exports = {
  behaviourPosture,
  REMARKS,
  KIND_LABEL,
  creditFor,
  remarksFor,
  validateRemarkRules,
  isAllowedVar,
  scoreAttempt,
  refreshRemarks,
  computeAnalytics,
  buildAnalyticsSheet,
  formatDateTime,
  formatDate,
  unlockDate,
};
