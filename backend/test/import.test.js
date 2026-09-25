// Import of the PassSection database JSON (synthetic fixture with the same
// structure), behaviour partial credit, remark rules, answer-key secrecy and
// the tamper-evident audit chain. Runs against the file store, or Supabase
// when TEST_SUPABASE_URL / TEST_SUPABASE_KEY are set.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psq-import-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'admin-secret';
process.env.SESSION_SECRET = 'test-secret';
const useSupabase = !!process.env.TEST_SUPABASE_URL;
if (useSupabase) {
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_KEY;
}

const XLSX = require('xlsx');
const app = require('../server');

const database = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-database.json'), 'utf8'));
let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
}

test('import database, score behaviour with partial credit, audit chain', async () => {
  const admin = client();
  await admin('POST', '/api/auth/login', { username: 'admin', password: 'admin-secret' });

  const imp = await admin('POST', '/api/admin/import', { database, meta: { title: 'Imported Exam', examDate: '2026-09-25' } });
  assert.equal(imp.status, 201, JSON.stringify(imp.data));
  assert.equal(imp.data.questions, 4);
  assert.equal(imp.data.created, 2);
  assert.equal(imp.data.assigned, 2);
  assert.equal(imp.data.adminInRoster, true);
  const examId = imp.data.exam.id;
  assert.equal(imp.data.exam.config.timerSeconds.BEHAVIOUR, 45);
  assert.equal(imp.data.exam.config.remarkRules.length, 3);

  // Editor view keeps the scoring model.
  const ed = await admin('GET', `/api/admin/exams/${examId}`);
  const b2 = ed.data.sections[1].questions[1];
  assert.deepEqual(b2.fullCredit, ['A']); // D is the correct letter; A is also full credit
  assert.equal(b2.revealMap.C, 'CONCERN: bypass');
  assert.equal(ed.data.sections[1].questions[0].scenarioHi, 'आप अकेले हैं।');

  // Roster admin row is ignored; its password does not work.
  assert.equal((await client()('POST', '/api/auth/login', { username: 'admin', password: 'ignored' })).status, 401);

  const p = client();
  const login = await p('POST', '/api/auth/login', { username: 'test.one', password: 'Pass@One1' });
  assert.equal(login.data.user.nameHi, 'परीक्षण एक');
  const started = await p('POST', `/api/exam/${examId}/start`, {});
  const raw = JSON.stringify(started.data);
  for (const secret of ['correct', 'revealMap', 'fullCredit', 'partial', 'concern', 'explanation', 'CONCERN', 'dimension', 'is_correct']) {
    assert.ok(!raw.includes(secret), `participant payload leaks "${secret}"`);
  }
  assert.equal(started.data.questions[2].scenarioEn, 'You are alone.');
  assert.equal(started.data.exam.timerSeconds.KNOWLEDGE, 30);

  const ev = (body) => p('POST', `/api/exam/${examId}/event`, body);
  await ev({ type: 'answer', q: 1, option: 'B' }); // K01 correct (w1)
  await ev({ type: 'view', q: 2, via: 'palette' });
  await ev({ type: 'answer', q: 2, option: 'C' }); // K02 wrong (w2)
  await ev({ type: 'answer', q: 2, option: 'A' }); // changed -> correct (w2)
  await ev({ type: 'lang', q: 2, from: 'en', to: 'hi' });
  await ev({ type: 'tab_hidden', q: 2 });
  await ev({ type: 'tab_visible', q: 2 });
  await ev({ type: 'view', q: 3, via: 'button' });
  await ev({ type: 'answer', q: 3, option: 'A' }); // B01 preferred-not-best -> 50% of w2 = 1
  await ev({ type: 'view', q: 4, via: 'button' });
  await ev({ type: 'answer', q: 4, option: 'C' }); // B02 concern -> 0 of w3
  await ev({ type: 'review' });
  await ev({ type: 'submit_attempt' });
  await p('POST', `/api/exam/${examId}/submit`, {});

  const detail = await admin('GET', `/api/admin/exams/${examId}/results/test.one`);
  const r = detail.data.result;
  // Points: K 1 + 2 = 3 of 3; B 1 + 0 = 1 of 5 -> total 4 / 8 = 50%
  assert.equal(r.correct, 4);
  assert.equal(r.total, 8);
  assert.equal(r.totalPct, 50);
  assert.equal(r.knowledgePct, 100);
  assert.equal(r.behaviourPct, 20);
  assert.equal(r.concernCount, 1);
  assert.equal(r.integrity.tabSwitches, 1);
  assert.equal(r.integrity.languageToggles, 1);
  assert.equal(r.integrity.answerChanges, 1);
  assert.deepEqual(r.remarks.map((x) => x.en), ['Rule two: knowledge ahead.']); // first matching rule only
  const dims = Object.fromEntries(r.dimensions.map((d) => [d.key, d.pct]));
  assert.deepEqual(dims, { regulatory_knowledge: 100, process_knowledge: 100, anger_threshold: 50, peer_relations: 0 });
  const b01 = detail.data.responses.find((x) => x.QID === 'B01');
  assert.equal(b01['Response Type'], 'Acceptable (partial)');
  assert.equal(b01.Interpretation, 'Firm');

  // Participant result: no integrity/concern data, even once released.
  await admin('PATCH', `/api/admin/exams/${examId}/status`, { status: 'Results Released' });
  const mine = await p('GET', `/api/result/${examId}`);
  assert.equal(mine.data.locked, false);
  assert.equal(mine.data.result.integrity, undefined);
  assert.equal(mine.data.result.concernCount, undefined);
  assert.equal(mine.data.result.dimensions.length, 4);

  // Analytics: behaviour distribution with interpretation, concerns list.
  const an = (await admin('GET', `/api/admin/exams/${examId}/analytics`)).data.analytics;
  assert.equal(an.concerns.length, 1);
  assert.equal(an.concerns[0].interpretation, 'CONCERN: bypass');
  const dist = an.behaviour.find((q) => q.qid === 'B02').options.find((o) => o.option === 'C');
  assert.equal(dist.count, 1);
  assert.equal(dist.kind, 'concern');

  // Audit trail: every expected event, chain intact.
  const events = new Set((await admin('GET', `/api/admin/audit?limit=500`)).data.entries.map((e) => e.Event));
  for (const e of [
    'LOGIN_ATTEMPT', 'LOGIN_SUCCESS', 'ADMIN_IMPORT_DATABASE', 'ADMIN_CREATE_EXAM', 'ADMIN_ADD_PARTICIPANT', 'EXAM_START',
    'QUESTION_VIEW', 'NAVIGATION', 'ANSWER_SELECT', 'ANSWER_CHANGE', 'LANGUAGE_TOGGLE', 'BROWSER_TAB_HIDDEN',
    'BROWSER_TAB_VISIBLE', 'REVIEW_SCREEN_VIEW', 'SUBMIT_ATTEMPT', 'SUBMIT_CONFIRM', 'ADMIN_VIEW_RESULT', 'RESULT_VIEW',
  ]) {
    assert.ok(events.has(e), `missing audit event ${e}`);
  }
  const verified = (await admin('GET', '/api/admin/audit/verify')).data;
  assert.equal(verified.ok, true, JSON.stringify(verified));

  // Excel download includes the exam's audit log and the new columns.
  const wb = XLSX.read((await admin('GET', `/api/admin/exams/${examId}/download`)).data);
  assert.ok(wb.SheetNames.includes('Audit_Log'));
  const summary = XLSX.utils.sheet_to_json(wb.Sheets['Participants Summary'])[0];
  assert.equal(summary['Tab Switches'], 1);
  assert.equal(summary['Concern Answers'], 1);
  assert.equal(summary['Composure Under Pressure %'], 50);
  const key = XLSX.utils.sheet_to_json(wb.Sheets['Answer Key']).find((k) => k.QID === 'B01');
  assert.equal(key['Partial Credit Options'], 'A');
  assert.equal(key['Concern Options'], 'C');

  // Tampering with a stored entry is detected (file store only; Supabase blocks updates outright).
  if (!useSupabase) {
    const store = require('../services/store');
    const file = store._auditFilePath();
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    const e = JSON.parse(lines[3]);
    e.data = e.data.replace('"success_flag":false', '"success_flag":true');
    e.username = `${e.username}x`;
    lines[3] = JSON.stringify(e);
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    store._resetAuditCache();
    const broken = (await admin('GET', '/api/admin/audit/verify')).data;
    assert.equal(broken.ok, false);
    assert.equal(broken.brokenAt, 4);
  }
});
