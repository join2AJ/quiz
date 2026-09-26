/**
 * File store: every piece of data lives in .xlsx files on disk. Used for local
 * development and for Node hosts with a persistent disk (Railway/Render).
 *
 *   data/app.xlsx                      Users, Exams, Assignments, Settings
 *   data/exams/<Title>_<Date>_Results.xlsx
 *        Participants Summary | Question-wise Responses | Answer Key | Analytics
 *        Sections | Questions
 *   data/attempts/<examId>.xlsx        in-progress / submitted attempt state
 *
 * Reads/writes are synchronous inside each call. Node runs one JS task at a
 * time, so a read-modify-write with no await in between cannot interleave with
 * another request — that is our lock. Run a single instance.
 */
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const x = require('../excelService');

const { SHEETS, OPTIONS, str, normalizeUsername } = x;

const APP_HEADERS = {
  Users: ['Username', 'Name', 'PasswordHash', 'CreatedAt', 'NameHi', 'Designation', 'Post', 'Shift', 'StaffId'],
  Exams: [
    'Id', 'Title', 'Team', 'Site', 'ExamDate', 'Instructions', 'InstructionsHi',
    'UnlockDays', 'EstimatedMinutes', 'Status', 'FileName', 'Thresholds', 'CreatedAt', 'Config',
  ],
  Assignments: ['ExamId', 'Username', 'AssignedAt'],
  Settings: ['Key', 'Value'],
};
const ATTEMPT_HEADERS = ['Username', 'Status', 'StartedAt', 'SubmittedAt', 'State', 'Result'];

function parseJson(v, fallback) {
  if (!v) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function ensureDirs() {
  for (const dir of [config.dataDir, config.examsDir, config.attemptsDir]) fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------- app workbook

function appWorkbook() {
  ensureDirs();
  let wb = x.readWorkbook(config.appFile);
  if (!wb) {
    wb = x.newWorkbook();
    for (const [name, headers] of Object.entries(APP_HEADERS)) x.setSheet(wb, name, [], headers);
    x.writeWorkbook(wb, config.appFile);
  }
  return wb;
}

const appRows = (sheet) => x.rows(appWorkbook(), sheet);

function saveAppRows(sheet, data) {
  const wb = appWorkbook();
  x.setSheet(wb, sheet, data, APP_HEADERS[sheet]);
  x.writeWorkbook(wb, config.appFile);
}

// Users -----------------------------------------------------------------

function usersSync() {
  return appRows('Users').map((r) => ({
    username: str(r.Username),
    name: str(r.Name),
    passwordHash: str(r.PasswordHash),
    createdAt: str(r.CreatedAt),
    nameHi: str(r.NameHi),
    designation: str(r.Designation),
    post: str(r.Post),
    shift: str(r.Shift),
    staffId: str(r.StaffId),
  }));
}

const PROFILE_FIELDS = [
  ['nameHi', 'NameHi'],
  ['designation', 'Designation'],
  ['post', 'Post'],
  ['shift', 'Shift'],
  ['staffId', 'StaffId'],
];

async function getUsers() {
  return usersSync();
}

async function getUser(username) {
  const u = normalizeUsername(username);
  return usersSync().find((r) => r.username === u) || null;
}

async function upsertUsers(list) {
  const data = appRows('Users');
  for (const user of list) {
    const u = normalizeUsername(user.username);
    let row = data.find((r) => str(r.Username) === u);
    if (!row) {
      row = { Username: u, Name: user.name, PasswordHash: user.passwordHash, CreatedAt: new Date().toISOString() };
      data.push(row);
    }
    if (user.name) row.Name = user.name;
    if (user.passwordHash) row.PasswordHash = user.passwordHash;
    for (const [k, col] of PROFILE_FIELDS) if (user[k] !== undefined) row[col] = user[k];
  }
  saveAppRows('Users', data);
}

async function deleteUser(username) {
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
    config: parseJson(r.Config, {}),
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
    Config: JSON.stringify(e.config || {}),
  };
}

const examsSync = () => appRows('Exams').map(examFromRow);

async function getExams() {
  return examsSync();
}

async function getExam(id) {
  return examsSync().find((e) => e.id === id) || null;
}

async function saveExam(exam) {
  if (!exam.fileName) {
    ensureDirs();
    const base = x.examFileBase(exam.title, exam.examDate);
    let name = `${base}.xlsx`;
    let n = 2;
    while (fs.existsSync(path.join(config.examsDir, name))) name = `${base}_${n++}.xlsx`;
    exam.fileName = name;
  }
  const data = examsSync();
  const idx = data.findIndex((e) => e.id === exam.id);
  if (idx >= 0) data[idx] = exam;
  else data.push(exam);
  saveAppRows('Exams', data.map(examToRow));
  return exam;
}

async function deleteExam(exam) {
  for (const f of [examPath(exam), attemptsPath(exam.id)]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* already gone */
    }
    x.forgetWorkbook(f);
  }
  saveAppRows('Exams', examsSync().filter((e) => e.id !== exam.id).map(examToRow));
  saveAppRows('Assignments', appRows('Assignments').filter((r) => str(r.ExamId) !== exam.id));
}

// Assignments -----------------------------------------------------------

const assignmentsSync = () =>
  appRows('Assignments').map((r) => ({ examId: str(r.ExamId), username: str(r.Username), assignedAt: str(r.AssignedAt) }));

async function getAssignments() {
  return assignmentsSync();
}

async function isAssigned(examId, username) {
  const u = normalizeUsername(username);
  return assignmentsSync().some((a) => a.examId === examId && a.username === u);
}

async function assign(examId, usernames) {
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

async function unassign(examId, username) {
  const u = normalizeUsername(username);
  saveAppRows('Assignments', appRows('Assignments').filter((r) => !(str(r.ExamId) === examId && str(r.Username) === u)));
}

// Settings + logo -------------------------------------------------------

function getSettingSync(key) {
  const row = appRows('Settings').find((r) => str(r.Key) === key);
  return row ? str(row.Value) : '';
}

function setSettingSync(key, value) {
  const data = appRows('Settings').filter((r) => str(r.Key) !== key);
  if (value !== null && value !== undefined && value !== '') data.push({ Key: key, Value: value });
  saveAppRows('Settings', data);
}

async function getSetting(key) {
  return getSettingSync(key);
}

async function setSetting(key, value) {
  setSettingSync(key, value);
}

async function getLogo() {
  const type = getSettingSync('logoType');
  if (!type || !fs.existsSync(config.logoFile)) return null;
  return { type, buffer: fs.readFileSync(config.logoFile) };
}

async function setLogo(type, buffer) {
  ensureDirs();
  fs.writeFileSync(config.logoFile, buffer);
  setSettingSync('logoType', type);
}

async function deleteLogo() {
  try {
    fs.unlinkSync(config.logoFile);
  } catch {
    /* no logo */
  }
  setSettingSync('logoType', '');
}

// ---------------------------------------------------------------- exam workbook

function examPath(exam) {
  return path.join(config.examsDir, exam.fileName);
}

function examWorkbook(exam) {
  ensureDirs();
  let wb = x.readWorkbook(examPath(exam));
  if (!wb) {
    wb = x.newWorkbook();
    x.setSheet(wb, SHEETS.summary, [], null);
    x.setSheet(wb, SHEETS.responses, [], null);
    x.setSheet(wb, SHEETS.answerKey, [], x.ANSWER_KEY_HEADERS);
    x.setSheetAoa(wb, SHEETS.analytics, [['Analytics'], ['No submissions yet.']]);
    x.setSheet(wb, SHEETS.sections, [], x.SECTION_HEADERS);
    x.setSheet(wb, SHEETS.questions, [], x.QUESTION_HEADERS);
    x.writeWorkbook(wb, examPath(exam));
  }
  return wb;
}

/** Full bank INCLUDING correct answers — server-side only. */
async function getQuestionBank(exam) {
  const wb = examWorkbook(exam);
  const sections = x.rows(wb, SHEETS.sections).map((r) => ({
    no: Number(r['Section No']),
    name: str(r.Name),
    nameHi: str(r['Name (HI)']),
    description: str(r.Description),
    descriptionHi: str(r['Description (HI)']),
  }));
  const key = new Map(x.rows(wb, SHEETS.answerKey).map((r) => [Number(r['Question No']), r]));
  const questions = x.rows(wb, SHEETS.questions).map((r) => {
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
      scenarioEn: str(r['Scenario (EN)']),
      scenarioHi: str(r['Scenario (HI)']),
      options: OPTIONS.map((o) => ({ key: o, en: str(r[`${o} (EN)`]), hi: str(r[`${o} (HI)`]) })),
      correct: str(k['Correct Option']).trim().toUpperCase(),
      explanation: str(k.Explanation),
      ...x.questionMeta({ ...x.keyMetaFromRow(k), correct: k['Correct Option'] }),
    };
  });
  sections.sort((a, b) => a.no - b.no);
  questions.sort((a, b) => a.no - b.no);
  return { sections, questions };
}

async function saveQuestionBank(exam, sections) {
  const bank = x.numberBank(sections);
  const wb = examWorkbook(exam);
  x.setSheet(wb, SHEETS.sections, x.sectionRows(bank.sections), x.SECTION_HEADERS);
  x.setSheet(wb, SHEETS.questions, x.questionRows(bank.questions), x.QUESTION_HEADERS);
  x.setSheet(wb, SHEETS.answerKey, x.answerKeyRows(bank.questions), x.ANSWER_KEY_HEADERS);
  x.writeWorkbook(wb, examPath(exam));
}

async function getSummaryRows(exam) {
  return x.rows(examWorkbook(exam), SHEETS.summary);
}

async function getResponseRows(exam, username) {
  const all = x.rows(examWorkbook(exam), SHEETS.responses);
  return username ? all.filter((r) => str(r.Username) === username) : all;
}

function writeResults(exam, wb, summary, responses, buildAnalytics) {
  x.setSheet(wb, SHEETS.summary, summary, x.unionKeys(summary));
  x.setSheet(wb, SHEETS.responses, responses, x.unionKeys(responses));
  x.setSheetAoa(wb, SHEETS.analytics, buildAnalytics(summary, responses));
  x.writeWorkbook(wb, examPath(exam));
}

/** Append one participant's submission block and refresh the Analytics sheet. */
async function saveSubmission(exam, summaryRow, responseRows, buildAnalytics) {
  const wb = examWorkbook(exam);
  const summary = x.rows(wb, SHEETS.summary).filter((r) => str(r.Username) !== summaryRow.Username);
  summary.push(summaryRow);
  const responses = x.rows(wb, SHEETS.responses).filter((r) => str(r.Username) !== summaryRow.Username);
  responses.push(...responseRows);
  writeResults(exam, wb, summary, responses, buildAnalytics);
}

async function removeSubmission(exam, username, buildAnalytics) {
  const wb = examWorkbook(exam);
  const summary = x.rows(wb, SHEETS.summary).filter((r) => str(r.Username) !== username);
  const responses = x.rows(wb, SHEETS.responses).filter((r) => str(r.Username) !== username);
  writeResults(exam, wb, summary, responses, buildAnalytics);
}

async function rewriteSummary(exam, summary, buildAnalytics) {
  const wb = examWorkbook(exam);
  writeResults(exam, wb, summary, x.rows(wb, SHEETS.responses), buildAnalytics);
}

// ---------------------------------------------------------------- attempts

function attemptsPath(examId) {
  return path.join(config.attemptsDir, `${examId.replace(/[^A-Za-z0-9_-]/g, '')}.xlsx`);
}

function attemptsWorkbook(examId) {
  ensureDirs();
  const file = attemptsPath(examId);
  let wb = x.readWorkbook(file);
  if (!wb) {
    wb = x.newWorkbook();
    x.setSheet(wb, 'Attempts', [], ATTEMPT_HEADERS);
    x.writeWorkbook(wb, file);
  }
  return wb;
}

function attemptsSync(examId) {
  return x.rows(attemptsWorkbook(examId), 'Attempts').map((r) => ({
    username: str(r.Username),
    status: str(r.Status),
    startedAt: str(r.StartedAt),
    submittedAt: str(r.SubmittedAt),
    state: parseJson(r.State, {}),
    result: parseJson(r.Result, null),
  }));
}

async function getAttempts(examId) {
  return attemptsSync(examId);
}

async function getAttempt(examId, username) {
  const u = normalizeUsername(username);
  return attemptsSync(examId).find((a) => a.username === u) || null;
}

async function saveAttempt(examId, attempt) {
  const wb = attemptsWorkbook(examId);
  const data = x.rows(wb, 'Attempts').filter((r) => str(r.Username) !== attempt.username);
  data.push({
    Username: attempt.username,
    Status: attempt.status,
    StartedAt: attempt.startedAt,
    SubmittedAt: attempt.submittedAt || '',
    State: JSON.stringify(attempt.state || {}),
    Result: attempt.result ? JSON.stringify(attempt.result) : '',
  });
  x.setSheet(wb, 'Attempts', data, ATTEMPT_HEADERS);
  x.writeWorkbook(wb, attemptsPath(examId));
}

async function deleteAttempt(examId, username) {
  const u = normalizeUsername(username);
  const wb = attemptsWorkbook(examId);
  x.setSheet(wb, 'Attempts', x.rows(wb, 'Attempts').filter((r) => str(r.Username) !== u), ATTEMPT_HEADERS);
  x.writeWorkbook(wb, attemptsPath(examId));
}

// ---------------------------------------------------------------- presence
// Who is logged in, on which device, and when they were last seen.
// data/presence.json: { [username]: { sid, device, loginAt, lastSeen, logoutAt, status, examId, stage } }

const presenceFile = () => path.join(config.dataDir, 'presence.json');
function readPresence() {
  try {
    return JSON.parse(fs.readFileSync(presenceFile(), 'utf8'));
  } catch {
    return {};
  }
}
async function getPresence(username) {
  return readPresence()[normalizeUsername(username)] || null;
}
async function setPresence(username, value) {
  ensureDirs();
  const all = readPresence();
  all[normalizeUsername(username)] = value;
  fs.writeFileSync(presenceFile(), JSON.stringify(all));
}
async function listPresence() {
  return Object.entries(readPresence()).map(([username, p]) => ({ username, ...p }));
}

// ---------------------------------------------------------------- audit log
// data/audit_log.jsonl, one entry per line. Each entry carries the SHA-256 of
// the previous entry (tamper-evident chain). See services/auditService.js.

const auditFile = () => path.join(config.dataDir, 'audit_log.jsonl');
let auditTail = null; // { seq, hash } cache of the last entry

function readAuditSync() {
  let text = '';
  try {
    text = fs.readFileSync(auditFile(), 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function appendAudit(entry, hashEntry) {
  ensureDirs();
  if (!auditTail) {
    const all = readAuditSync();
    const last = all[all.length - 1];
    auditTail = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: '0'.repeat(64) };
  }
  const row = { ...entry, seq: auditTail.seq + 1, prev_hash: auditTail.hash };
  row.hash = hashEntry(row);
  fs.appendFileSync(auditFile(), `${JSON.stringify(row)}\n`);
  auditTail = { seq: row.seq, hash: row.hash };
}

async function getAudit({ examId, username, event, limit, beforeSeq } = {}) {
  let rows = readAuditSync();
  if (examId) rows = rows.filter((r) => r.exam_id === examId);
  if (username) rows = rows.filter((r) => r.username === username);
  if (event) rows = rows.filter((r) => r.event === event);
  if (beforeSeq) rows = rows.filter((r) => r.seq < beforeSeq);
  rows.sort((a, b) => b.seq - a.seq);
  return limit ? rows.slice(0, limit) : rows;
}

/** Every entry in chain order (for verification). */
async function getAuditChain() {
  return readAuditSync().sort((a, b) => a.seq - b.seq);
}

async function init() {
  ensureDirs();
  return { store: 'files', dataDir: config.dataDir };
}

// Used only by tests to simulate tampering.
function _auditFilePath() {
  return auditFile();
}
function _resetAuditCache() {
  auditTail = null;
}

module.exports = {
  kind: 'files',
  init,
  getUsers,
  getUser,
  upsertUsers,
  deleteUser,
  getExams,
  getExam,
  saveExam,
  deleteExam,
  getAssignments,
  isAssigned,
  assign,
  unassign,
  getSetting,
  getPresence,
  setPresence,
  listPresence,
  setSetting,
  getLogo,
  setLogo,
  deleteLogo,
  getQuestionBank,
  saveQuestionBank,
  getSummaryRows,
  getResponseRows,
  saveSubmission,
  removeSubmission,
  rewriteSummary,
  getAttempts,
  getAttempt,
  saveAttempt,
  deleteAttempt,
  appendAudit,
  getAudit,
  getAuditChain,
  _auditFilePath,
  _resetAuditCache,
};
