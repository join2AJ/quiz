/**
 * Tamper-evident audit trail.
 *
 * Every entry: { seq, ts (ISO 8601 UTC), event, username, exam_id, data, prev_hash, hash }
 * where data is a JSON string of the event's fields and
 *   hash = sha256(prev_hash \n seq \n ts \n event \n username \n exam_id \n data).
 * Changing, removing or re-ordering any entry breaks every hash after it, and
 * verify() reports the first broken entry.
 *
 * Supabase computes seq/prev_hash/hash in a trigger (under a lock, so concurrent
 * serverless requests cannot fork the chain); the file store computes them here.
 */
const crypto = require('crypto');
const config = require('../config');
const store = require('./store');

const EVENTS = [
  'LOGIN_ATTEMPT', 'LOGIN_SUCCESS', 'LOGOUT', 'EXAM_START', 'QUESTION_VIEW', 'ANSWER_SELECT', 'ANSWER_CHANGE',
  'QUESTION_FLAG', 'NAVIGATION', 'LANGUAGE_TOGGLE', 'REVIEW_SCREEN_VIEW', 'SUBMIT_ATTEMPT', 'SUBMIT_CONFIRM',
  'RESULT_VIEW', 'ADMIN_CREATE_EXAM', 'ADMIN_ADD_PARTICIPANT', 'ADMIN_VIEW_RESULT', 'ADMIN_DOWNLOAD_EXCEL',
  'ADMIN_CHANGE_THRESHOLD', 'SESSION_TIMEOUT', 'BROWSER_TAB_HIDDEN', 'BROWSER_TAB_VISIBLE',
  // Additional admin actions, beyond the specified 22:
  'ADMIN_IMPORT_DATABASE', 'ADMIN_RESET_ATTEMPT', 'ADMIN_CHANGE_STATUS', 'ADMIN_EDIT_TEXT',
];

const GENESIS = '0'.repeat(64);

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function hashEntry(e) {
  return sha256([e.prev_hash, String(e.seq), e.ts, e.event, e.username || '', e.exam_id || '', e.data].join('\n'));
}

/** IPs are stored only as a keyed SHA-256 (privacy), consistent within one deployment. */
function hashIp(ip) {
  if (!ip) return '';
  return crypto.createHmac('sha256', config.sessionSecret || 'psq').update(String(ip)).digest('hex');
}

function clientIp(req) {
  if (!req) return '';
  return (config.isServerless && req.headers['x-nf-client-connection-ip']) || req.ip || '';
}

/**
 * Record one event. Never throws: an audit failure is logged to the console
 * but does not break the participant's exam.
 */
async function log(req, event, fields = {}) {
  const session = (req && req.session) || {};
  const user = session.user || {};
  const username = fields.username ?? fields.admin_username ?? user.username ?? '';
  const examId = fields.exam_id ?? fields.exam_id_if_active ?? '';
  const data = {
    timestamp: new Date().toISOString(),
    ...fields,
    session_id: fields.session_id ?? session.sid ?? '',
    ip_address: fields.ip_address ?? hashIp(clientIp(req)),
  };
  const entry = {
    ts: data.timestamp,
    event,
    username: String(username || ''),
    exam_id: String(examId || ''),
    data: JSON.stringify(data),
  };
  try {
    await store.appendAudit(entry, hashEntry);
  } catch (err) {
    console.error(`[audit] could not record ${event}:`, err.message);
  }
}

/** Recompute the whole chain. */
async function verify() {
  const rows = await store.getAuditChain();
  let prev = GENESIS;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const expectedSeq = i + 1;
    if (Number(r.seq) !== expectedSeq) {
      return { ok: false, count: rows.length, brokenAt: expectedSeq, reason: `entry #${expectedSeq} is missing` };
    }
    if (r.prev_hash !== prev) {
      return { ok: false, count: rows.length, brokenAt: r.seq, reason: `entry #${r.seq} does not link to the previous entry` };
    }
    if (hashEntry(r) !== r.hash) {
      return { ok: false, count: rows.length, brokenAt: r.seq, reason: `entry #${r.seq} was modified` };
    }
    prev = r.hash;
  }
  return { ok: true, count: rows.length, lastHash: prev };
}

/** Flatten entries for tables / Excel. */
function toRows(entries) {
  return entries.map((e) => {
    let data = {};
    try {
      data = JSON.parse(e.data);
    } catch {
      /* keep empty */
    }
    const { timestamp, session_id: sessionId, ip_address: ip, ...rest } = data;
    return {
      Seq: Number(e.seq),
      'Timestamp (UTC)': e.ts,
      Event: e.event,
      Username: e.username,
      'Exam ID': e.exam_id,
      Details: Object.entries(rest)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('; '),
      'Session ID': sessionId || '',
      'IP (SHA-256)': ip || '',
      'Prev Hash': e.prev_hash,
      Hash: e.hash,
    };
  });
}

module.exports = { EVENTS, log, verify, hashEntry, hashIp, toRows };
