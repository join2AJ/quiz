/**
 * Supabase (Postgres) store — used on serverless hosts such as Netlify, where
 * the filesystem is not persistent. Same interface as fileStore. Excel files
 * are generated on demand when the admin downloads results.
 *
 * Uses the service_role key (server-side only). Tables have RLS enabled with
 * no policies, so the public anon key cannot read anything.
 */
const { createClient } = require('@supabase/supabase-js');
const config = require('../../config');
const { OPTIONS, normalizeUsername, examFileBase, numberBank, questionMeta } = require('../excelService');

const PAGE = 1000; // PostgREST returns at most 1000 rows per request by default

let client;
function db() {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Decode a JWT payload without verifying it (only to explain configuration mistakes). */
function jwtPayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function projectRef(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Configuration problems we can spot without calling Supabase (wrong kind of
 * key, key from another project, a URL that is not the project URL).
 */
/** Safe description of the configured key: length and first 4 characters only. */
function keyHint() {
  const key = config.supabaseKey;
  const raw = config.supabaseKeyRaw;
  const notes = [`the value set is ${key.length} characters long and starts with "${key.slice(0, 4)}…"`];
  if (/\s/.test(raw.trim())) notes.push('it contained spaces or line breaks');
  return ` (For reference: ${notes.join('; ')}. A service_role key is about 200+ characters and starts with "eyJh"; a secret key starts with "sb_secret_".)`;
}

function configProblem() {
  const url = config.supabaseUrl;
  const key = config.supabaseKey;
  if (!/^https?:\/\//.test(url)) return `SUPABASE_URL must look like https://<project>.supabase.co (got "${url.slice(0, 60)}").`;
  if (/supabase\.com\/dashboard/.test(url)) {
    return 'SUPABASE_URL is the dashboard address. Use the Project URL from Project Settings → API (https://<project>.supabase.co).';
  }
  if (!key) return 'SUPABASE_SERVICE_ROLE_KEY is empty.';
  if (/^(EYJ|SB_SECRET_|SB_PUBLISHABLE_)/.test(key)) {
    return `SUPABASE_SERVICE_ROLE_KEY is in CAPITAL letters (Caps Lock?). Keys are case-sensitive — copy and paste it exactly from Supabase instead of typing it.${keyHint()}`;
  }
  if (key.startsWith('sb_publishable_')) {
    return 'SUPABASE_SERVICE_ROLE_KEY is the publishable (public) key. Use the secret key: Project Settings → API Keys → Secret keys (sb_secret_…), or the legacy service_role key.';
  }
  if (key.startsWith('sb_secret_')) return null;
  const payload = jwtPayload(key);
  if (!payload) {
    return `SUPABASE_SERVICE_ROLE_KEY is not a Supabase API key — it may be the JWT Secret, the database password, or only part of the key. Copy the service_role key (starts with "eyJ") or a secret key (sb_secret_…) from Project Settings → API Keys using the copy button.${keyHint()}`;
  }
  if (payload.role === 'anon') {
    return 'SUPABASE_SERVICE_ROLE_KEY is the anon (public) key. Copy the service_role key instead (Project Settings → API Keys → Legacy API keys → service_role → Reveal).';
  }
  if (payload.role && payload.role !== 'service_role') {
    return `SUPABASE_SERVICE_ROLE_KEY has role "${payload.role}". It must be the service_role key.`;
  }
  const ref = projectRef(url);
  if (ref && payload.ref && payload.ref !== ref) {
    return `SUPABASE_SERVICE_ROLE_KEY belongs to project "${payload.ref}", but SUPABASE_URL is project "${ref}". Use the URL and key of the same project.`;
  }
  return null;
}

/** Turn a Supabase/PostgREST error into a message an admin can act on. */
function explain(error) {
  const msg = String((error && error.message) || error || '');
  const code = error && error.code;
  if (/invalid api key|jwt|jws|no api key|apikey|unauthorized|legacy api keys are disabled/i.test(msg)) {
    return { status: 503, message: `Supabase rejected the key (${msg}). ${configProblem() || `Check that SUPABASE_SERVICE_ROLE_KEY is the service_role / secret key of the same project as SUPABASE_URL, then redeploy.${keyHint()}`}` };
  }
  if (code === '42P01' || code === 'PGRST205' || /does not exist|could not find the table|schema cache/i.test(msg)) {
    return { status: 503, message: `Database tables are missing or out of date (${msg}). Run supabase/schema.sql in the Supabase SQL Editor.` };
  }
  if (code === '42703' || /column .* does not exist|could not find the .* column/i.test(msg)) {
    return { status: 503, message: `The database is missing new columns (${msg}). Run supabase/schema.sql again in the Supabase SQL Editor.` };
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|getaddrinfo|network/i.test(msg)) {
    return { status: 503, message: `Cannot reach Supabase at ${config.supabaseUrl} (${msg}). Check SUPABASE_URL and that the project is not paused.` };
  }
  return { status: 500, message: `Database error: ${msg}` };
}

function check({ data, error }) {
  if (error) {
    const { status, message } = explain(error);
    const err = new Error(message);
    err.status = status;
    err.cause = error;
    throw err;
  }
  return data;
}

/** Fetch every row of a query, paging past the 1000-row limit. */
async function selectAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check(await build().range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function insertChunks(table, rows) {
  for (let i = 0; i < rows.length; i += 500) check(await db().from(table).insert(rows.slice(i, i + 500)));
}

// ---------------------------------------------------------------- users

const userFromRow = (r) => ({
  username: r.username,
  name: r.name,
  passwordHash: r.password_hash,
  createdAt: r.created_at,
  nameHi: r.name_hi || '',
  designation: r.designation || '',
  post: r.post || '',
  shift: r.shift || '',
  staffId: r.staff_id || '',
});

const PROFILE_COLUMNS = [
  ['nameHi', 'name_hi'],
  ['designation', 'designation'],
  ['post', 'post'],
  ['shift', 'shift'],
  ['staffId', 'staff_id'],
];

async function getUsers() {
  return (await selectAll(() => db().from('psq_users').select('*').order('username'))).map(userFromRow);
}

async function getUser(username) {
  const r = check(await db().from('psq_users').select('*').eq('username', normalizeUsername(username)).maybeSingle());
  return r ? userFromRow(r) : null;
}

async function upsertUsers(list) {
  if (!list.length) return;
  const names = list.map((u) => normalizeUsername(u.username));
  const existing = new Map();
  for (let i = 0; i < names.length; i += 200) {
    const rows = check(await db().from('psq_users').select('*').in('username', names.slice(i, i + 200)));
    for (const r of rows) existing.set(r.username, r);
  }
  const rows = list.map((user) => {
    const u = normalizeUsername(user.username);
    const old = existing.get(u) || {};
    const row = {
      username: u,
      name: user.name || old.name || '',
      password_hash: user.passwordHash || old.password_hash,
    };
    for (const [k, col] of PROFILE_COLUMNS) row[col] = user[k] !== undefined ? user[k] : old[col] || '';
    return row;
  });
  check(await db().from('psq_users').upsert(rows, { onConflict: 'username' }));
}

async function deleteUser(username) {
  check(await db().from('psq_users').delete().eq('username', normalizeUsername(username)));
}

// ---------------------------------------------------------------- exams

function examFromRow(r) {
  return {
    id: r.id,
    title: r.title,
    team: r.team,
    site: r.site,
    examDate: r.exam_date,
    instructions: r.instructions,
    instructionsHi: r.instructions_hi,
    unlockDays: r.unlock_days,
    estimatedMinutes: r.estimated_minutes,
    status: r.status,
    fileName: r.file_name,
    thresholds: { ...config.defaultThresholds, ...(r.thresholds || {}) },
    createdAt: r.created_at,
    config: r.config || {},
  };
}

function examToRow(e) {
  return {
    id: e.id,
    title: e.title,
    team: e.team,
    site: e.site,
    exam_date: e.examDate,
    instructions: e.instructions,
    instructions_hi: e.instructionsHi,
    unlock_days: e.unlockDays,
    estimated_minutes: e.estimatedMinutes,
    status: e.status,
    file_name: e.fileName,
    thresholds: e.thresholds || {},
    created_at: e.createdAt,
    config: e.config || {},
  };
}

async function getExams() {
  return (await selectAll(() => db().from('psq_exams').select('*').order('created_at'))).map(examFromRow);
}

async function getExam(id) {
  const r = check(await db().from('psq_exams').select('*').eq('id', id).maybeSingle());
  return r ? examFromRow(r) : null;
}

async function saveExam(exam) {
  if (!exam.fileName) {
    // Keep names unique among exams, like files on disk would be.
    const base = examFileBase(exam.title, exam.examDate);
    const taken = new Set((await getExams()).map((e) => e.fileName));
    let name = `${base}.xlsx`;
    let n = 2;
    while (taken.has(name)) name = `${base}_${n++}.xlsx`;
    exam.fileName = name;
  }
  check(await db().from('psq_exams').upsert(examToRow(exam), { onConflict: 'id' }));
  return exam;
}

async function deleteExam(exam) {
  // Child tables cascade.
  check(await db().from('psq_exams').delete().eq('id', exam.id));
}

// ---------------------------------------------------------------- assignments

async function getAssignments() {
  const rows = await selectAll(() => db().from('psq_assignments').select('*').order('exam_id').order('username'));
  return rows.map((r) => ({ examId: r.exam_id, username: r.username, assignedAt: r.assigned_at }));
}

async function isAssigned(examId, username) {
  const r = check(
    await db().from('psq_assignments').select('exam_id').eq('exam_id', examId).eq('username', normalizeUsername(username)).maybeSingle(),
  );
  return !!r;
}

async function assign(examId, usernames) {
  const list = [...new Set((Array.isArray(usernames) ? usernames : [usernames]).map(normalizeUsername))];
  if (!list.length) return 0;
  const already = new Set();
  for (let i = 0; i < list.length; i += 200) {
    const rows = check(await db().from('psq_assignments').select('username').eq('exam_id', examId).in('username', list.slice(i, i + 200)));
    for (const r of rows) already.add(r.username);
  }
  const fresh = list.filter((u) => !already.has(u));
  if (fresh.length) {
    check(
      await db()
        .from('psq_assignments')
        .upsert(fresh.map((u) => ({ exam_id: examId, username: u })), { onConflict: 'exam_id,username', ignoreDuplicates: true }),
    );
  }
  return fresh.length;
}

async function unassign(examId, username) {
  check(await db().from('psq_assignments').delete().eq('exam_id', examId).eq('username', normalizeUsername(username)));
}

// ---------------------------------------------------------------- settings + logo

async function getSetting(key) {
  const r = check(await db().from('psq_settings').select('value').eq('key', key).maybeSingle());
  return r ? r.value : '';
}

async function setSetting(key, value) {
  if (value === null || value === undefined || value === '') {
    check(await db().from('psq_settings').delete().eq('key', key));
  } else {
    check(await db().from('psq_settings').upsert({ key, value: String(value) }, { onConflict: 'key' }));
  }
}

async function getLogo() {
  const v = await getSetting('logo');
  const m = /^([^;]+);base64,(.+)$/.exec(v);
  return m ? { type: m[1], buffer: Buffer.from(m[2], 'base64') } : null;
}

async function setLogo(type, buffer) {
  await setSetting('logo', `${type};base64,${buffer.toString('base64')}`);
}

async function deleteLogo() {
  await setSetting('logo', '');
}

// ---------------------------------------------------------------- question bank

/** Full bank INCLUDING correct answers — server-side only. */
async function getQuestionBank(exam) {
  const [sections, questions, key] = await Promise.all([
    selectAll(() => db().from('psq_sections').select('*').eq('exam_id', exam.id).order('no')),
    selectAll(() => db().from('psq_questions').select('*').eq('exam_id', exam.id).order('no')),
    selectAll(() => db().from('psq_answer_key').select('*').eq('exam_id', exam.id).order('no')),
  ]);
  const keyByNo = new Map(key.map((k) => [k.no, k]));
  return {
    sections: sections.map((s) => ({
      no: s.no,
      name: s.name,
      nameHi: s.name_hi,
      description: s.description,
      descriptionHi: s.description_hi,
    })),
    questions: questions.map((q) => {
      const k = keyByNo.get(q.no) || {};
      return {
        no: q.no,
        qid: q.qid,
        sectionNo: q.section_no,
        type: (q.type || '').toUpperCase(),
        category: q.category,
        difficulty: q.difficulty || '',
        textEn: q.text_en,
        textHi: q.text_hi,
        scenarioEn: q.scenario_en || '',
        scenarioHi: q.scenario_hi || '',
        options: OPTIONS.map((o, i) => {
          const opt = (q.options || [])[i] || {};
          return { key: o, en: opt.en || '', hi: opt.hi || '' };
        }),
        correct: (k.correct || '').toUpperCase(),
        explanation: k.explanation || '',
        ...questionMeta({ ...(k.meta || {}), correct: k.correct, difficulty: q.difficulty }),
      };
    }),
  };
}

async function saveQuestionBank(exam, sections) {
  const bank = numberBank(sections);
  for (const table of ['psq_answer_key', 'psq_questions', 'psq_sections']) {
    check(await db().from(table).delete().eq('exam_id', exam.id));
  }
  await insertChunks(
    'psq_sections',
    bank.sections.map((s) => ({
      exam_id: exam.id,
      no: s.no,
      name: s.name,
      name_hi: s.nameHi,
      description: s.description,
      description_hi: s.descriptionHi,
    })),
  );
  await insertChunks(
    'psq_questions',
    bank.questions.map((q) => ({
      exam_id: exam.id,
      no: q.no,
      qid: q.qid,
      section_no: q.sectionNo,
      type: q.type,
      category: q.category,
      difficulty: q.difficulty || '',
      text_en: q.textEn,
      text_hi: q.textHi,
      scenario_en: q.scenarioEn || '',
      scenario_hi: q.scenarioHi || '',
      options: q.options.map((o) => ({ en: o.en, hi: o.hi })),
    })),
  );
  await insertChunks(
    'psq_answer_key',
    bank.questions.map((q) => ({
      exam_id: exam.id,
      no: q.no,
      correct: q.correct,
      category: q.category,
      explanation: q.explanation,
      meta: {
        fullCredit: q.fullCredit,
        partial: q.partial,
        concern: q.concern,
        neutral: q.neutral,
        dimension: q.dimension,
        weight: q.weight,
        difficulty: q.difficulty,
        tags: q.tags,
        explanationHi: q.explanationHi,
        revealMap: q.revealMap,
      },
    })),
  );
}

// ---------------------------------------------------------------- results

async function getSummaryRows(exam) {
  const rows = await selectAll(() => db().from('psq_summary').select('row').eq('exam_id', exam.id).order('submitted_at').order('username'));
  return rows.map((r) => r.row);
}

async function getResponseRows(exam, username) {
  const rows = await selectAll(() => {
    let q = db().from('psq_responses').select('row').eq('exam_id', exam.id);
    if (username) q = q.eq('username', username);
    return q.order('username').order('question_no');
  });
  return rows.map((r) => r.row);
}

async function saveSubmission(exam, summaryRow, responseRows) {
  const username = summaryRow.Username;
  check(await db().from('psq_responses').delete().eq('exam_id', exam.id).eq('username', username));
  await insertChunks(
    'psq_responses',
    responseRows.map((r) => ({ exam_id: exam.id, username, question_no: r['Question No'], row: r })),
  );
  check(
    await db()
      .from('psq_summary')
      .upsert({ exam_id: exam.id, username, row: summaryRow, submitted_at: new Date().toISOString() }, { onConflict: 'exam_id,username' }),
  );
}

async function removeSubmission(exam, username) {
  check(await db().from('psq_responses').delete().eq('exam_id', exam.id).eq('username', username));
  check(await db().from('psq_summary').delete().eq('exam_id', exam.id).eq('username', username));
}

/** Update summary rows in place (e.g. refreshed remarks). */
async function rewriteSummary(exam, summary) {
  if (!summary.length) return;
  const rows = summary.map((r) => ({ exam_id: exam.id, username: r.Username, row: r }));
  for (let i = 0; i < rows.length; i += 500) {
    check(await db().from('psq_summary').upsert(rows.slice(i, i + 500), { onConflict: 'exam_id,username', defaultToNull: false }));
  }
}

// ---------------------------------------------------------------- attempts

const attemptFromRow = (r) => ({
  username: r.username,
  status: r.status,
  startedAt: r.started_at,
  submittedAt: r.submitted_at || '',
  state: r.state || {},
  result: r.result || null,
});

async function getAttempts(examId) {
  return (await selectAll(() => db().from('psq_attempts').select('*').eq('exam_id', examId).order('username'))).map(attemptFromRow);
}

async function getAttempt(examId, username) {
  const r = check(
    await db().from('psq_attempts').select('*').eq('exam_id', examId).eq('username', normalizeUsername(username)).maybeSingle(),
  );
  return r ? attemptFromRow(r) : null;
}

async function saveAttempt(examId, attempt) {
  check(
    await db()
      .from('psq_attempts')
      .upsert(
        {
          exam_id: examId,
          username: attempt.username,
          status: attempt.status,
          started_at: attempt.startedAt,
          submitted_at: attempt.submittedAt || null,
          state: attempt.state || {},
          result: attempt.result || null,
        },
        { onConflict: 'exam_id,username' },
      ),
  );
}

async function deleteAttempt(examId, username) {
  check(await db().from('psq_attempts').delete().eq('exam_id', examId).eq('username', normalizeUsername(username)));
}

// ---------------------------------------------------------------- audit log
// seq, prev_hash and hash are set by the psq_audit_chain trigger (see schema.sql).

async function appendAudit(entry) {
  check(await db().from('psq_audit_log').insert(entry));
}

async function getAudit({ examId, username, event, limit, beforeSeq } = {}) {
  const build = () => {
    let q = db().from('psq_audit_log').select('*');
    if (examId) q = q.eq('exam_id', examId);
    if (username) q = q.eq('username', username);
    if (event) q = q.eq('event', event);
    if (beforeSeq) q = q.lt('seq', beforeSeq);
    return q.order('seq', { ascending: false });
  };
  if (limit) return check(await build().limit(limit));
  return selectAll(build);
}

async function getAuditChain() {
  return selectAll(() => db().from('psq_audit_log').select('*').order('seq'));
}

async function init() {
  const problem = configProblem();
  if (problem) {
    const err = new Error(problem);
    err.status = 503;
    throw err;
  }
  // Touch the newest table and column so an outdated schema is reported too.
  let result;
  try {
    result = await db().from('psq_audit_log').select('seq').limit(1);
  } catch (e) {
    result = { error: e };
  }
  if (result.error) {
    const { message } = explain(result.error);
    const err = new Error(message);
    err.status = 503;
    throw err;
  }
  return { store: 'supabase', project: projectRef(config.supabaseUrl) || config.supabaseUrl };
}

module.exports = {
  kind: 'supabase',
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
};
