/**
 * The participant's own report, shown once results are released: what the
 * score means, where they are strong, how to improve, every question with the
 * correct answer, and how the score was calculated. Bilingual (en/hi).
 * Admin-only signals (concern labels, integrity, speed) are never included.
 */

const BANDS = [
  {
    min: 85,
    en: 'Excellent',
    hi: 'उत्कृष्ट',
    meanEn: 'You know the rules very well and handle workplace situations the way the team expects. You can guide and support colleagues.',
    meanHi: 'आप नियमों को बहुत अच्छी तरह जानते हैं और कार्यस्थल की परिस्थितियों को टीम की अपेक्षा के अनुसार संभालते हैं। आप सहकर्मियों का मार्गदर्शन कर सकते हैं।',
  },
  {
    min: 70,
    en: 'Good',
    hi: 'अच्छा',
    meanEn: 'You have a good grasp of the rules and usually choose the right response. A little revision on the areas below will make you fully confident.',
    meanHi: 'आपको नियमों की अच्छी समझ है और आप आमतौर पर सही प्रतिक्रिया चुनते हैं। नीचे दिए गए क्षेत्रों को थोड़ा दोहराने से आप पूरी तरह आश्वस्त हो जाएँगे।',
  },
  {
    min: 50,
    en: 'Fair',
    hi: 'संतोषजनक',
    meanEn: 'You know the basics, but several answers were not the best choice. Revise the areas below and discuss them with your supervisor.',
    meanHi: 'आप मूल बातें जानते हैं, लेकिन कई उत्तर सबसे अच्छे विकल्प नहीं थे। नीचे दिए गए क्षेत्रों को दोहराएँ और अपने पर्यवेक्षक के साथ चर्चा करें।',
  },
  {
    min: -1,
    en: 'Needs improvement',
    hi: 'सुधार की आवश्यकता',
    meanEn: 'Many answers were not the best choice. This is a chance to learn: go through every answer below, revise the rules and ask your supervisor for guidance.',
    meanHi: 'कई उत्तर सबसे अच्छे विकल्प नहीं थे। यह सीखने का अवसर है: नीचे दिए गए हर उत्तर को देखें, नियमों को दोहराएँ और अपने पर्यवेक्षक से मार्गदर्शन लें।',
  },
];

const band = (pct) => BANDS.find((b) => (Number(pct) || 0) >= b.min);

// How to improve, matched on the area's name or key.
const TIPS = [
  [/integrity|honest|ethic/i, 'Follow the rule even when no one is watching. Never bend a procedure for a friend, a senior or a VIP — record it and report it.', 'नियम का पालन तब भी करें जब कोई देख न रहा हो। किसी मित्र, वरिष्ठ या VIP के लिए प्रक्रिया न मोड़ें — उसे दर्ज करें और रिपोर्ट करें।'],
  [/one.?team|team|peer|cooperat|colleague/i, 'Help colleagues when the counter is busy, share information openly and solve disagreements calmly, without blaming.', 'काउंटर व्यस्त होने पर सहकर्मियों की मदद करें, जानकारी खुलकर साझा करें और बिना दोष दिए शांति से असहमति सुलझाएँ।'],
  [/excellen|quality|accura/i, 'Double-check every pass and document before it leaves your desk. Small errors in a pass are security risks.', 'हर पास और दस्तावेज़ को अपनी मेज़ से जाने से पहले दोबारा जाँचें। पास में छोटी गलती भी सुरक्षा जोखिम है।'],
  [/customer|applicant|service|satisf/i, 'Explain clearly what is missing and what the applicant must do next; be polite, but do not skip a rule to please them.', 'आवेदक को साफ़ बताएँ कि क्या कमी है और आगे क्या करना है; विनम्र रहें, पर उन्हें खुश करने के लिए कोई नियम न छोड़ें।'],
  [/respect/i, 'Speak respectfully to everyone — applicants, colleagues, housekeeping and seniors alike — especially when you disagree.', 'सभी से सम्मानपूर्वक बात करें — आवेदक, सहकर्मी, हाउसकीपिंग और वरिष्ठ — खासकर जब आप असहमत हों।'],
  [/disciplin|punctual/i, 'Be on time, follow the shift handover and registers exactly, and keep your workstation and records in order.', 'समय पर आएँ, शिफ्ट हैंडओवर और रजिस्टर का ठीक से पालन करें, और अपना कार्यस्थल व रिकॉर्ड व्यवस्थित रखें।'],
  [/priorit|urgent|workload/i, 'When many tasks arrive together, do the safety- and deadline-critical work first, tell your supervisor what will be delayed, and do not leave half-done passes.', 'जब कई काम एक साथ आएँ, तो सुरक्षा और समय-सीमा वाले काम पहले करें, पर्यवेक्षक को बताएँ कि क्या देर होगा, और कोई पास अधूरा न छोड़ें।'],
  [/owner|accountab|responsib/i, 'Take ownership of your work: if you made a mistake, report it early and help fix it.', 'अपने काम की ज़िम्मेदारी लें: यदि गलती हुई है तो जल्दी बताएँ और उसे ठीक करने में मदद करें।'],
  [/safety|security/i, 'Security comes first: when in doubt, stop, check the rule and ask your supervisor before issuing anything.', 'सुरक्षा सबसे पहले: संदेह होने पर रुकें, नियम जाँचें और कुछ भी जारी करने से पहले पर्यवेक्षक से पूछें।'],
  [/composure|pressure|stress|calm/i, 'Under pressure, stay calm and polite, follow the procedure step by step and escalate instead of arguing.', 'दबाव में शांत और विनम्र रहें, प्रक्रिया का चरण-दर-चरण पालन करें और बहस करने के बजाय ऊपर बताएँ।'],
  [/direction|instruction|follow|comply/i, 'Follow instructions from your supervisor and written orders; if you disagree, raise it respectfully after doing what is required.', 'पर्यवेक्षक के निर्देशों और लिखित आदेशों का पालन करें; असहमति हो तो आवश्यक कार्य करने के बाद सम्मानपूर्वक बात रखें।'],
  [/self.?aware|feedback|learn/i, 'Ask for feedback on your work and accept it openly; note your own mistakes and what you will do differently.', 'अपने काम पर प्रतिक्रिया माँगें और उसे खुले मन से स्वीकारें; अपनी गलतियाँ नोट करें और तय करें कि आगे क्या अलग करेंगे।'],
  [/loyal|institution/i, 'Protect the organisation’s information and reputation; discuss concerns inside the team, not outside.', 'संगठन की जानकारी और प्रतिष्ठा की रक्षा करें; चिंताओं पर टीम के अंदर चर्चा करें, बाहर नहीं।'],
  [/regulat|rule|sop|process|procedure|knowledge/i, 'Re-read the relevant rule or SOP, then ask your supervisor to take you through one real case of each topic below.', 'संबंधित नियम या SOP दोबारा पढ़ें, फिर पर्यवेक्षक से नीचे दिए हर विषय का एक वास्तविक उदाहरण समझें।'],
];
const DEFAULT_TIP = [
  'Go through the questions below where your answer was not the best, read the correct answer and discuss it with your supervisor.',
  'नीचे वे प्रश्न देखें जहाँ आपका उत्तर सबसे अच्छा नहीं था, सही उत्तर पढ़ें और अपने पर्यवेक्षक से चर्चा करें।',
];

function tipFor(label, key) {
  const hit = TIPS.find(([re]) => re.test(`${label} ${key}`));
  return hit ? { en: hit[1], hi: hit[2] } : { en: DEFAULT_TIP[0], hi: DEFAULT_TIP[1] };
}

function outcomeOf(row) {
  const chosen = row['Option Selected'];
  if (!chosen || chosen === '—') return 'skipped';
  const credit = Number(row.Credit);
  if (credit >= 1) return 'best';
  if (credit > 0) return 'partly';
  return 'notBest';
}

function build({ exam, bank, result, rows }) {
  const b = band(result.totalPct);
  const byNo = new Map(rows.map((r) => [Number(r['Question No']), r]));

  // Areas: every scored dimension, strongest and weakest.
  const areas = (result.dimensions || []).map((d) => ({ key: d.key, label: d.label, labelHi: d.labelHi || '', group: d.group, pct: d.pct }));
  const strengths = areas.filter((a) => a.pct >= 70).sort((x, y) => y.pct - x.pct);
  const improve = areas
    .filter((a) => a.pct < 70)
    .sort((x, y) => x.pct - y.pct)
    .map((a) => ({ ...a, tip: tipFor(a.label, a.key) }));

  // Knowledge topics to revise: those with a question not answered best.
  const topics = new Map();
  for (const q of bank.questions) {
    const r = byNo.get(q.no);
    if (!r || q.type !== 'KNOWLEDGE' || outcomeOf(r) === 'best') continue;
    const t = topics.get(q.category) || { topic: q.category, questions: [] };
    t.questions.push(q.qid || `Q${q.no}`);
    topics.set(q.category, t);
  }

  const answers =
    exam.config && exam.config.showAnswersInResult === false
      ? null
      : bank.questions.map((q) => {
          const r = byNo.get(q.no) || {};
          const accepted = [...new Set([...(q.fullCredit || []), ...(q.partial || [])])].filter((k) => k !== q.correct);
          return {
            no: q.no,
            qid: q.qid || '',
            sectionNo: q.sectionNo,
            textEn: q.textEn,
            textHi: q.textHi,
            scenarioEn: q.scenarioEn || '',
            scenarioHi: q.scenarioHi || '',
            options: q.options.map((o) => ({ key: o.key, en: o.en, hi: o.hi })),
            yours: r['Option Selected'] && r['Option Selected'] !== '—' ? r['Option Selected'] : '',
            best: q.correct,
            accepted,
            outcome: outcomeOf(r),
            points: Number(r.Points) || 0,
            weight: Number(r.Weight) || 1,
            explanationEn: q.explanation || '',
            explanationHi: q.explanationHi || '',
          };
        });

  const weights = bank.questions.map((q) => Number(q.weight) || 1);
  return {
    band: { en: b.en, hi: b.hi },
    meaning: { en: b.meanEn, hi: b.meanHi },
    strengths,
    improve,
    topics: [...topics.values()],
    answers,
    howCalculated: {
      questions: bank.questions.length,
      maxPoints: result.total,
      weighted: weights.some((w) => w !== 1),
      partialCreditPct: Number(exam.config && exam.config.partialCreditPct) >= 0 ? Number(exam.config.partialCreditPct) : 50,
      bands: BANDS.filter((x) => x.min >= 0).map((x) => ({ min: x.min, en: x.en, hi: x.hi })),
    },
  };
}

module.exports = { build, band, tipFor };
