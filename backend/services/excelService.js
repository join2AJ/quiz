/**
 * Excel persistence layer. Every piece of data lives in .xlsx files:
 *
 *   data/app.xlsx                      Users, Exams, Assignments, Settings
 *   data/exams/<Title>_<Date>_Results.xlsx
 *        Participants Summary | Question-wise Responses | Answer Key | Analytics
 *        Sections | Questions   (question bank — the answer key is kept apart)
 *   data/attempts/<examId>.xlsx        in-progress / submitted attempt state
 *
 * All reads/writes are synchronous. Node runs one JS task at a time, so a
 * read-modify-write done without awaiting in between cannot interleave with
 * another request — that is our lock.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const config = require('../config');

XLSX.set_fs(fs);

const SHEETS = {
  summary: 'Participants Summary',
  responses: 'Question-wise Responses',
  answerKey: 'Answer Key',
  analytics: 'Analytics',
  sections: 'Sections',
  questions: 'Questions',
};

const APP_HEADERS = {
  Users: ['Username', 'Name', 'PasswordHash', 'CreatedAt'],
  Exams: [
    'Id', 'Title', 'Team', 'Site', 'ExamDate', 'Instructions', 'InstructionsHi',
    'UnlockDays', 'EstimatedMinutes', 'Status', 'FileName', 'Thresholds', 'CreatedAt',
  ],
  Assignments: ['ExamId', 'Username', 'AssignedAt'],
  Settings: ['Key', 'Value'],
};

const SECTION_HEADERS = ['Section No', 'Name', 'Name (HI)', 'Description', 'Description (HI)'];
const QUESTION_HEADERS = [
  'Question No', 'QID', 'Section No', 'Type', 'Category', 'Question (EN)', 'Question (HI)',
  'A (EN)', 'A (HI)', 'B (EN)', 'B (HI)', 'C (EN)', 'C (HI)', 'D (EN)', 'D (HI)',
];
const ANSWER_KEY_HEADERS = ['Question No', 'Correct Option', 'Category', 'Explanation'];
const ATTEMPT_HEADERS = ['Username', 'Status', 'StartedAt', 'SubmittedAt', 'State', 'Result'];
const OPTIONS = ['A', 'B', 'C', 'D'];

// ---------------------------------------------------------------- low level

const cache = new Map(); // file -> { mtimeMs, wb }

function ensureDirs() {
  for (const dir of [config.dataDir, config.examsDir, config.attemptsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

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

function rows(wb, name) {
  const ws = wb && wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
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

function unionKeys(data) {
  const keys = [];
  for (const row of data) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
  return keys;
}

function str(v) {
  return v === undefined || v === null ? '' : String(v);
}

function parseJson(v, fallback) {
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- app store

function appWorkbook() {
  ensureDirs();
  let wb = readWorkbook(config.appFile);
  if (!wb) {
    wb = XLSX.utils.book_new();
    for (const [name, headers] of Object.entries(APP_HEADERS)) setSheet(wb, name, [], headers);
    writeWorkbook(wb, config.appFile);
  }
  return wb;
}

function appRows(sheet) {
  return rows(appWorkbook(), sheet);
}

function saveAppRows(sheet, data) {
  const wb = appWorkbook();
  setSheet(wb, sheet, data, APP_HEADERS[sheet]);
  writeWorkbook(wb, config.appFile);
}

// Users -----------------------------------------------------------------

function normalizeUsername(u) {
  return str(u).trim().toLowerCase();
}

function getUsers() {
  return appRows('Users').map((r) => ({
    username: str(r.Username),
    name: str(r.Name),
    passwordHash: str(r.PasswordHash),
    createdAt: str(r.CreatedAt),
  }));
}

function getUser(username) {
  const u = normalizeUsername(username);
  return getUsers().find((x) => x.username === u) || null;
}

/** Create or update one or many users in a single write. */
function upsertUsers(list) {
  const data = appRows('Users');
  for (const { username, name, passwordHash } of list) {
    const u = normalizeUsername(username);
    const existing = data.find((r) => str(r.Username) === u);
    if (existing) {
      if (name) existing.Name = name;
      if (passwordHash) existing.PasswordHash = passwordHash;
    } else {
      data.push({ Username: u, Name: name, PasswordHash: passwordHash, CreatedAt: new Date().toISOString() });
    }
  }
  saveAppRows('Users', data);
}

function upsertUser(user) {
  upsertUsers([user]);
  return getUser(user.username);
}

function deleteUser(username) {
  const u = normalizeUsername(username);
  saveAppRows('Users', appRows('Users').filter((r) => str(r.Username) !== u));
  saveAppRows('Assignments', appRows('Assignments').filter((r) => str(r.Username) !== u));
}

// Exams -----------------------------------------------------------------

function examFromRow(r) {
  return {
    id: str(r.Id),
    title: str(r.Title),
    team: str(r.Team),
    site: str(r.Site),
    examDate: str(r.ExamDate),
    instructions: str(r.Instructions),
    instructionsHi: str(r.InstructionsHi),
    unlockDays: r.UnlockDays === '' ? config.defaultUnlockDays : Number(r.UnlockDays),
    estimatedMinutes: r.EstimatedMinutes === '' ? null : Number(r.EstimatedMinutes),
    status: str(r.Status) || 'Active',
    fileName: str(r.FileName),
    thresholds: { ...config.defaultThresholds, ...parseJson(r.Thresholds, {}) },
    createdAt: str(r.CreatedAt),
  };
}

function examToRow(e) {
  return {
    Id: e.id,
    Title: e.title,
    Team: e.team,
    Site: e.site,
    ExamDate: e.examDate,
    Instructions: e.instructions,
    InstructionsHi: e.instructionsHi,
    UnlockDays: e.unlockDays,
    EstimatedMinutes: e.estimatedMinutes ?? '',
    Status: e.status,
    FileName: e.fileName,
    Thresholds: JSON.stringify(e.thresholds || {}),
    CreatedAt: e.createdAt,
  };
}

function getExams() {
  return appRows('Exams').map(examFromRow);
}

function getExam(id) {
  return getExams().find((e) => e.id === id) || null;
}

function saveExam(exam) {
  const data = getExams();
  const idx = data.findIndex((e) => e.id === exam.id);
  if (idx >= 0) data[idx] = exam;
  else data.push(exam);
  saveAppRows('Exams', data.map(examToRow));
  return exam;
}

function deleteExamRecord(id) {
  saveAppRows('Exams', getExams().filter((e) => e.id !== id).map(examToRow));
  saveAppRows('Assignments', appRows('Assignments').filter((r) => str(r.ExamId) !== id));
}

function examFileName(title, date) {
  const safe = (s) => str(s).replace(/[^A-Za-z0-9ऀ-ॿ-]+/g, '_').replace(/^_+|_+$/g, '');
  const base = `${safe(title) || 'Exam'}_${safe(date) || 'undated'}_Results`;
  let name = `${base}.xlsx`;
  let n = 2;
  while (fs.existsSync(path.join(config.examsDir, name))) name = `${base}_${n++}.xlsx`;
  return name;
}

// Assignments -----------------------------------------------------------

function getAssignments() {
  return appRows('Assignments').map((r) => ({
    examId: str(r.ExamId),
    username: str(r.Username),
    assignedAt: str(r.AssignedAt),
  }));
}

function isAssigned(examId, username) {
  const u = normalizeUsername(username);
  return getAssignments().some((a) => a.examId === examId && a.username === u);
}

function assign(examId, usernames) {
  const list = (Array.isArray(usernames) ? usernames : [usernames]).map(normalizeUsername);
  const data = appRows('Assignments');
  let added = 0;
  for (const u of list) {
    if (data.some((r) => str(r.ExamId) === examId && str(r.Username) === u)) continue;
    data.push({ ExamId: examId, Username: u, AssignedAt: new Date().toISOString() });
    added += 1;
  }
  if (added) saveAppRows('Assignments', data);
  return added;
}

function unassign(examId, username) {
  const u = normalizeUsername(username);
  saveAppRows(
    'Assignments',
    appRows('Assignments').filter((r) => !(str(r.ExamId) === examId && str(r.Username) === u)),
  );
}

// Settings --------------------------------------------------------------

function getSetting(key) {
  const row = appRows('Settings').find((r) => str(r.Key) === key);
  return row ? str(row.Value) : '';
}

function setSetting(key, value) {
  const data = appRows('Settings').filter((r) => str(r.Key) !== key);
  if (value !== null && value !== undefined && value !== '') data.push({ Key: key, Value: value });
  saveAppRows('Settings', data);
}

// ---------------------------------------------------------------- exam workbook

function examPath(exam) {
  return path.join(config.examsDir, exam.fileName);
}

function examWorkbook(exam) {
  ensureDirs();
  let wb = readWorkbook(examPath(exam));
  if (!wb) {
    wb = XLSX.utils.book_new();
    setSheet(wb, SHEETS.summary, [], null);
    setSheet(wb, SHEETS.responses, [], null);
    setSheet(wb, SHEETS.answerKey, [], ANSWER_KEY_HEADERS);
    setSheetAoa(wb, SHEETS.analytics, [['Analytics'], ['No submissions yet.']]);
    setSheet(wb, SHEETS.sections, [], SECTION_HEADERS);
    setSheet(wb, SHEETS.questions, [], QUESTION_HEADERS);
    writeWorkbook(wb, examPath(exam));
  }
  return wb;
}

/**
 * Full question bank INCLUDING correct answers. Server-side only — never pass
 * the result of this function to a participant response.
 */
function getQuestionBank(exam) {
  const wb = examWorkbook(exam);
  const sections = rows(wb, SHEETS.sections).map((r) => ({
    no: Number(r['Section No']),
    name: str(r.Name),
    nameHi: str(r['Name (HI)']),
    description: str(r.Description),
    descriptionHi: str(r['Description (HI)']),
  }));
  const key = new Map(rows(wb, SHEETS.answerKey).map((r) => [Number(r['Question No']), r]));
  const questions = rows(wb, SHEETS.questions).map((r) => {
    const no = Number(r['Question No']);
    const k = key.get(no) || {};
    return {
      no,
      qid: str(r.QID),
      sectionNo: Number(r['Section No']),
      type: str(r.Type).toUpperCase(),
      category: str(r.Category),
      textEn: str(r['Question (EN)']),
      textHi: str(r['Question (HI)']),
      options: OPTIONS.map((o) => ({ key: o, en: str(r[`${o} (EN)`]), hi: str(r[`${o} (HI)`]) })),
      correct: str(k['Correct Option']).trim().toUpperCase(),
      explanation: str(k.Explanation),
    };
  });
  sections.sort((a, b) => a.no - b.no);
  questions.sort((a, b) => a.no - b.no);
  return { sections, questions };
}

/** Write sections + questions; answer key goes to its own sheet. */
function saveQuestionBank(exam, sections) {
  const wb = examWorkbook(exam);
  const sectionRows = [];
  const questionRows = [];
  const keyRows = [];
  let qNo = 0;
  sections.forEach((s, i) => {
    const sNo = i + 1;
    sectionRows.push({
      'Section No': sNo,
      Name: s.name,
      'Name (HI)': s.nameHi || '',
      Description: s.description || '',
      'Description (HI)': s.descriptionHi || '',
    });
    for (const q of s.questions || []) {
      qNo += 1;
      const row = {
        'Question No': qNo,
        QID: q.qid || `Q${Date.now().toString(36)}${qNo}`,
        'Section No': sNo,
        Type: str(q.type).toUpperCase(),
        Category: q.category || '',
        'Question (EN)': q.textEn || '',
        'Question (HI)': q.textHi || '',
      };
      OPTIONS.forEach((o, oi) => {
        const opt = (q.options || [])[oi] || {};
        row[`${o} (EN)`] = opt.en || '';
        row[`${o} (HI)`] = opt.hi || '';
      });
      questionRows.push(row);
      keyRows.push({
        'Question No': qNo,
        'Correct Option': str(q.correct).toUpperCase(),
        Category: q.category || '',
        Explanation: q.explanation || '',
      });
    }
  });
  setSheet(wb, SHEETS.sections, sectionRows, SECTION_HEADERS);
  setSheet(wb, SHEETS.questions, questionRows, QUESTION_HEADERS);
  setSheet(wb, SHEETS.answerKey, keyRows, ANSWER_KEY_HEADERS);
  writeWorkbook(wb, examPath(exam));
}

function getSummaryRows(exam) {
  return rows(examWorkbook(exam), SHEETS.summary);
}

function getResponseRows(exam) {
  return rows(examWorkbook(exam), SHEETS.responses);
}

/** Append one participant's submission block and refresh the Analytics sheet. */
function appendSubmission(exam, summaryRow, responseRows, buildAnalytics) {
  const wb = examWorkbook(exam);
  const summary = rows(wb, SHEETS.summary).filter((r) => str(r.Username) !== summaryRow.Username);
  summary.push(summaryRow);
  const responses = rows(wb, SHEETS.responses).filter((r) => str(r.Username) !== summaryRow.Username);
  responses.push(...responseRows);
  setSheet(wb, SHEETS.summary, summary, unionKeys(summary));
  setSheet(wb, SHEETS.responses, responses, unionKeys(responses));
  setSheetAoa(wb, SHEETS.analytics, buildAnalytics(summary, responses));
  writeWorkbook(wb, examPath(exam));
}

/** Remove one participant's rows (used when admin resets an attempt). */
function removeSubmission(exam, username, buildAnalytics) {
  const wb = examWorkbook(exam);
  const summary = rows(wb, SHEETS.summary).filter((r) => str(r.Username) !== username);
  const responses = rows(wb, SHEETS.responses).filter((r) => str(r.Username) !== username);
  setSheet(wb, SHEETS.summary, summary, unionKeys(summary));
  setSheet(wb, SHEETS.responses, responses, unionKeys(responses));
  setSheetAoa(wb, SHEETS.analytics, buildAnalytics(summary, responses));
  writeWorkbook(wb, examPath(exam));
}

/** Rewrite the summary sheet (e.g. to refresh remarks) and analytics. */
function rewriteSummary(exam, summary, buildAnalytics) {
  const wb = examWorkbook(exam);
  const responses = rows(wb, SHEETS.responses);
  setSheet(wb, SHEETS.summary, summary, unionKeys(summary));
  setSheetAoa(wb, SHEETS.analytics, buildAnalytics(summary, responses));
  writeWorkbook(wb, examPath(exam));
}

/** Buffer of the exam workbook suitable for download. */
function examWorkbookBuffer(exam) {
  const wb = examWorkbook(exam);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function deleteExamFiles(exam) {
  for (const f of [examPath(exam), attemptsPath(exam.id)]) {
    try {
      fs.unlinkSync(f);
      cache.delete(f);
    } catch {
      /* already gone */
    }
  }
}

// ---------------------------------------------------------------- attempts

function attemptsPath(examId) {
  return path.join(config.attemptsDir, `${examId.replace(/[^A-Za-z0-9_-]/g, '')}.xlsx`);
}

function attemptsWorkbook(examId) {
  ensureDirs();
  const file = attemptsPath(examId);
  let wb = readWorkbook(file);
  if (!wb) {
    wb = XLSX.utils.book_new();
    setSheet(wb, 'Attempts', [], ATTEMPT_HEADERS);
    writeWorkbook(wb, file);
  }
  return wb;
}

function attemptFromRow(r) {
  return {
    username: str(r.Username),
    status: str(r.Status),
    startedAt: str(r.StartedAt),
    submittedAt: str(r.SubmittedAt),
    state: parseJson(r.State, {}),
    result: parseJson(r.Result, null),
  };
}

function getAttempts(examId) {
  return rows(attemptsWorkbook(examId), 'Attempts').map(attemptFromRow);
}

function getAttempt(examId, username) {
  const u = normalizeUsername(username);
  return getAttempts(examId).find((a) => a.username === u) || null;
}

function saveAttempt(examId, attempt) {
  const wb = attemptsWorkbook(examId);
  const data = rows(wb, 'Attempts').filter((r) => str(r.Username) !== attempt.username);
  data.push({
    Username: attempt.username,
    Status: attempt.status,
    StartedAt: attempt.startedAt,
    SubmittedAt: attempt.submittedAt || '',
    State: JSON.stringify(attempt.state || {}),
    Result: attempt.result ? JSON.stringify(attempt.result) : '',
  });
  setSheet(wb, 'Attempts', data, ATTEMPT_HEADERS);
  writeWorkbook(wb, attemptsPath(examId));
}

function deleteAttempt(examId, username) {
  const u = normalizeUsername(username);
  const wb = attemptsWorkbook(examId);
  setSheet(wb, 'Attempts', rows(wb, 'Attempts').filter((r) => str(r.Username) !== u), ATTEMPT_HEADERS);
  writeWorkbook(wb, attemptsPath(examId));
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
  ensureDirs,
  normalizeUsername,
  getUsers,
  getUser,
  upsertUser,
  upsertUsers,
  deleteUser,
  getExams,
  getExam,
  saveExam,
  deleteExamRecord,
  examFileName,
  getAssignments,
  isAssigned,
  assign,
  unassign,
  getSetting,
  setSetting,
  getQuestionBank,
  saveQuestionBank,
  getSummaryRows,
  getResponseRows,
  appendSubmission,
  removeSubmission,
  rewriteSummary,
  examWorkbookBuffer,
  deleteExamFiles,
  getAttempts,
  getAttempt,
  saveAttempt,
  deleteAttempt,
  parseCsv,
};
