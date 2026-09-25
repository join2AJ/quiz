/**
 * Excel helpers (SheetJS). Used by:
 *   - the file store, which keeps all data in .xlsx files on disk, and
 *   - the admin download, which builds the results workbook from whichever
 *     store is active (files locally, Supabase on Netlify).
 */
const fs = require('fs');
const XLSX = require('xlsx');

XLSX.set_fs(fs);

const SHEETS = {
  summary: 'Participants Summary',
  responses: 'Question-wise Responses',
  answerKey: 'Answer Key',
  analytics: 'Analytics',
  sections: 'Sections',
  questions: 'Questions',
};

const OPTIONS = ['A', 'B', 'C', 'D'];
const SECTION_HEADERS = ['Section No', 'Name', 'Name (HI)', 'Description', 'Description (HI)'];
const QUESTION_HEADERS = [
  'Question No', 'QID', 'Section No', 'Type', 'Category', 'Question (EN)', 'Question (HI)',
  'A (EN)', 'A (HI)', 'B (EN)', 'B (HI)', 'C (EN)', 'C (HI)', 'D (EN)', 'D (HI)',
];
const ANSWER_KEY_HEADERS = ['Question No', 'Correct Option', 'Category', 'Explanation'];

function str(v) {
  return v === undefined || v === null ? '' : String(v);
}

function normalizeUsername(u) {
  return str(u).trim().toLowerCase();
}

/** `[ExamTitle]_[Date]_Results` (without extension). */
function examFileBase(title, date) {
  const safe = (s) => str(s).replace(/[^A-Za-z0-9ऀ-ॿ-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safe(title) || 'Exam'}_${safe(date) || 'undated'}_Results`;
}

// ---------------------------------------------------------------- workbook primitives

const cache = new Map(); // file -> { mtimeMs, wb }

function readWorkbook(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.wb;
  const wb = XLSX.readFile(file);
  cache.set(file, { mtimeMs: stat.mtimeMs, wb });
  return wb;
}

function writeWorkbook(wb, file) {
  const tmp = `${file}.${process.pid}.tmp`;
  XLSX.writeFile(wb, tmp, { bookType: 'xlsx', compression: true });
  fs.renameSync(tmp, file);
  cache.set(file, { mtimeMs: fs.statSync(file).mtimeMs, wb });
}

function forgetWorkbook(file) {
  cache.delete(file);
}

function newWorkbook() {
  return XLSX.utils.book_new();
}

function rows(wb, name) {
  const ws = wb && wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
}

function unionKeys(data) {
  const keys = [];
  for (const row of data) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
  return keys;
}

/** Replace (or create) a sheet from an array of objects with a fixed header order. */
function setSheet(wb, name, data, headers) {
  const keys = headers || unionKeys(data);
  const ws = XLSX.utils.json_to_sheet(data, { header: keys });
  if (!data.length) XLSX.utils.sheet_add_aoa(ws, [keys], { origin: 'A1' });
  ws['!cols'] = keys.map((k) => ({ wch: Math.min(60, Math.max(10, String(k).length + 2)) }));
  if (wb.Sheets[name]) wb.Sheets[name] = ws;
  else XLSX.utils.book_append_sheet(wb, ws, name);
}

function setSheetAoa(wb, name, aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  if (wb.Sheets[name]) wb.Sheets[name] = ws;
  else XLSX.utils.book_append_sheet(wb, ws, name);
}

// ---------------------------------------------------------------- bank <-> sheet rows

function sectionRows(sections) {
  return sections.map((s) => ({
    'Section No': s.no,
    Name: s.name,
    'Name (HI)': s.nameHi || '',
    Description: s.description || '',
    'Description (HI)': s.descriptionHi || '',
  }));
}

function questionRows(questions) {
  return questions.map((q) => {
    const row = {
      'Question No': q.no,
      QID: q.qid,
      'Section No': q.sectionNo,
      Type: q.type,
      Category: q.category || '',
      'Question (EN)': q.textEn || '',
      'Question (HI)': q.textHi || '',
    };
    OPTIONS.forEach((o, i) => {
      const opt = q.options[i] || {};
      row[`${o} (EN)`] = opt.en || '';
      row[`${o} (HI)`] = opt.hi || '';
    });
    return row;
  });
}

function answerKeyRows(questions) {
  return questions.map((q) => ({
    'Question No': q.no,
    'Correct Option': q.correct,
    Category: q.category || '',
    Explanation: q.explanation || '',
  }));
}

/**
 * Turn the editor's sections (each with nested questions) into a numbered
 * bank: { sections: [{no,...}], questions: [{no, sectionNo, ...}] }.
 */
function numberBank(sections) {
  const outSections = [];
  const outQuestions = [];
  let qNo = 0;
  sections.forEach((s, i) => {
    const sNo = i + 1;
    outSections.push({
      no: sNo,
      name: s.name,
      nameHi: s.nameHi || '',
      description: s.description || '',
      descriptionHi: s.descriptionHi || '',
    });
    for (const q of s.questions || []) {
      qNo += 1;
      outQuestions.push({
        no: qNo,
        qid: q.qid || `Q${Date.now().toString(36)}${qNo}`,
        sectionNo: sNo,
        type: str(q.type).toUpperCase(),
        category: q.category || '',
        textEn: q.textEn || '',
        textHi: q.textHi || '',
        options: OPTIONS.map((_, oi) => {
          const o = (q.options || [])[oi] || {};
          return { key: OPTIONS[oi], en: o.en || '', hi: o.hi || '' };
        }),
        correct: str(q.correct).toUpperCase(),
        explanation: q.explanation || '',
      });
    }
  });
  return { sections: outSections, questions: outQuestions };
}

/** Results workbook for download: the four report sheets + the question bank. */
function buildResultsWorkbook({ summary, responses, bank, analyticsAoa }) {
  const wb = newWorkbook();
  setSheet(wb, SHEETS.summary, summary, unionKeys(summary));
  setSheet(wb, SHEETS.responses, responses, unionKeys(responses));
  setSheet(wb, SHEETS.answerKey, answerKeyRows(bank.questions), ANSWER_KEY_HEADERS);
  setSheetAoa(wb, SHEETS.analytics, analyticsAoa);
  setSheet(wb, SHEETS.sections, sectionRows(bank.sections), SECTION_HEADERS);
  setSheet(wb, SHEETS.questions, questionRows(bank.questions), QUESTION_HEADERS);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

/** Parse CSV text into objects (header row required). */
function parseCsv(text) {
  const wb = XLSX.read(text, { type: 'string', raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
}

module.exports = {
  SHEETS,
  OPTIONS,
  SECTION_HEADERS,
  QUESTION_HEADERS,
  ANSWER_KEY_HEADERS,
  str,
  normalizeUsername,
  examFileBase,
  readWorkbook,
  writeWorkbook,
  forgetWorkbook,
  newWorkbook,
  rows,
  unionKeys,
  setSheet,
  setSheetAoa,
  sectionRows,
  questionRows,
  answerKeyRows,
  numberBank,
  buildResultsWorkbook,
  parseCsv,
};
