const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psq-test-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'admin-secret';
process.env.SESSION_SECRET = 'test-secret';
// Set TEST_SUPABASE_URL + TEST_SUPABASE_KEY to run the same flow against Supabase/PostgREST.
const useSupabase = !!process.env.TEST_SUPABASE_URL;
if (useSupabase) {
  process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.TEST_SUPABASE_KEY;
}

const XLSX = require('xlsx');
const app = require('../server');

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
  return async function call(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data };
  };
}

const opts = (p) => ['A', 'B', 'C', 'D'].map((o) => ({ en: `${p} ${o}`, hi: `${p} ${o} हि` }));

test('full admin + participant flow', async () => {
  const admin = client();
  assert.equal((await admin('POST', '/api/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
  assert.equal((await admin('POST', '/api/auth/login', { username: 'admin', password: 'admin-secret' })).status, 200);

  const created = await admin('POST', '/api/admin/exams', {
    title: 'Test Exam',
    team: 'Pass Section',
    site: 'Airport',
    examDate: '2026-09-25',
    unlockDays: 10,
    sections: [
      {
        name: 'Knowledge',
        questions: [
          { textEn: 'Q1', textHi: 'प्र1', options: opts('q1'), correct: 'A', type: 'KNOWLEDGE', category: 'Basics' },
          { textEn: 'Q2', options: opts('q2'), correct: 'B', type: 'KNOWLEDGE', category: 'Basics' },
        ],
      },
      {
        name: 'Behaviour',
        questions: [
          { textEn: 'Q3', options: opts('q3'), correct: 'C', type: 'BEHAVIOUR', category: 'Anger' },
          { textEn: 'Q4', options: opts('q4'), correct: 'D', type: 'BEHAVIOUR', category: 'Anger' },
        ],
      },
    ],
  });
  assert.equal(created.status, 201);
  const examId = created.data.exam.id;

  const bulk = await admin('POST', '/api/admin/participants/bulk', {
    examId,
    csv: 'name,username,password\nAsha Singh,asha,pass1234\nRavi Kumar,ravi,pass5678\nBad,x,1',
  });
  assert.equal(bulk.data.created, 2);
  assert.equal(bulk.data.errors.length, 1);

  const p = client();
  assert.equal((await p('POST', '/api/auth/login', { username: 'asha', password: 'nope' })).data.error, 'Invalid credentials');
  assert.equal((await p('POST', '/api/auth/login', { username: 'asha', password: 'pass1234' })).status, 200);
  assert.equal((await p('GET', '/api/admin/exams')).status, 403);

  const pre = await p('GET', `/api/exam/${examId}`);
  assert.equal(pre.data.totalQuestions, 4);
  assert.equal(pre.data.questions, undefined);

  const started = await p('POST', `/api/exam/${examId}/start`);
  assert.equal(started.data.questions.length, 4);
  const raw = JSON.stringify(started.data);
  assert.ok(!raw.includes('"correct"'), 'answer key must not leak');

  await p('POST', `/api/exam/${examId}/event`, { type: 'answer', q: 1, option: 'B' });
  await p('POST', `/api/exam/${examId}/event`, { type: 'answer', q: 1, option: 'A' }); // changed once
  await p('POST', `/api/exam/${examId}/event`, { type: 'view', q: 2 });
  await p('POST', `/api/exam/${examId}/event`, { type: 'flag', q: 2, flagged: true });
  await p('POST', `/api/exam/${examId}/event`, { type: 'answer', q: 3, option: 'C' });
  const resumed = await p('GET', `/api/exam/${examId}`);
  assert.deepEqual(resumed.data.progress.answers, { 1: 'A', 3: 'C' });
  assert.deepEqual(resumed.data.progress.flags, { 2: true });

  const submitted = await p('POST', `/api/exam/${examId}/submit`);
  assert.equal(submitted.status, 200);
  assert.equal(submitted.data.attempt.unlocked, false);

  const locked = await p('GET', `/api/result/${examId}`);
  assert.equal(locked.data.locked, true);
  assert.equal(locked.data.result, undefined);

  // Other participant cannot see Asha's result
  const r = client();
  await r('POST', '/api/auth/login', { username: 'ravi', password: 'pass5678' });
  assert.equal((await r('GET', `/api/result/${examId}`)).status, 404);

  // Admin sees everything from day 0
  const detail = await admin('GET', `/api/admin/exams/${examId}/results/asha`);
  assert.equal(detail.data.result.correct, 2);
  assert.equal(detail.data.result.totalPct, 50);
  const q1 = detail.data.responses.find((x) => x['Question No'] === 1);
  assert.equal(q1['Times Changed'], 1);

  // Release results → participant can now see them
  await admin('PATCH', `/api/admin/exams/${examId}/status`, { status: 'Results Released' });
  const open = await p('GET', `/api/result/${examId}`);
  assert.equal(open.data.locked, false);
  assert.equal(open.data.result.knowledgePct, 50);
  assert.equal(open.data.result.behaviourPct, 50);
  assert.ok(open.data.result.remarks.length >= 1);

  const dl = await admin('GET', `/api/admin/exams/${examId}/download`);
  assert.equal(dl.status, 200);
  const wb = XLSX.read(dl.data);
  for (const s of ['Participants Summary', 'Question-wise Responses', 'Answer Key', 'Analytics']) {
    assert.ok(wb.SheetNames.includes(s), `missing sheet ${s}`);
  }
  const summary = XLSX.utils.sheet_to_json(wb.Sheets['Participants Summary']);
  assert.equal(summary[0].Name, 'Asha Singh');
  assert.equal(summary[0]['Section 1 Score %'], 50);
  assert.equal(created.data.exam.fileName, 'Test_Exam_2026-09-25_Results.xlsx');
  if (!useSupabase) assert.ok(fs.existsSync(path.join(dataDir, 'exams', 'Test_Exam_2026-09-25_Results.xlsx')));

  const health = await admin('GET', '/api/health');
  assert.equal(health.data.store, useSupabase ? 'supabase' : 'files');

  // Reset lets the participant retake; their rows leave the results.
  await admin('DELETE', `/api/admin/exams/${examId}/attempts/asha`);
  const after = await admin('GET', `/api/admin/exams/${examId}/analytics`);
  assert.equal(after.data.analytics.participants, 0);

  // Deleting the exam removes everything tied to it.
  await admin('DELETE', `/api/admin/exams/${examId}`);
  assert.equal((await admin('GET', `/api/admin/exams/${examId}`)).status, 404);
});
