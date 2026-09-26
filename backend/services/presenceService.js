/**
 * Who is logged in, where, and what they are doing.
 *
 * One record per participant: the current session id, the device, login and
 * last-seen times, and a stage (waiting, exam, submitted, result). A
 * participant can be logged in on one device at a time: logging in elsewhere
 * asks first, and the older session is then ended on its next request.
 */
const store = require('./store');
const cache = require('./cache');

// Seen within this time = online (the browser pings every minute).
const ONLINE_MS = 150 * 1000;
// Last-seen is written at most this often per person, unless the stage changes.
const WRITE_EVERY_MS = 45 * 1000;
const CACHE_MS = 5 * 1000;

const key = (username) => `presence:${username}`;

function describeDevice(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\/|Opera/.test(s)
      ? 'Opera'
      : /SamsungBrowser/.test(s)
        ? 'Samsung Internet'
        : /Firefox\//.test(s)
          ? 'Firefox'
          : /Chrome\//.test(s)
            ? 'Chrome'
            : /Safari\//.test(s)
              ? 'Safari'
              : 'Browser';
  const os = /Windows/.test(s)
    ? 'Windows'
    : /Android/.test(s)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(s)
        ? 'iPhone/iPad'
        : /Mac OS X/.test(s)
          ? 'Mac'
          : /Linux/.test(s)
            ? 'Linux'
            : 'unknown system';
  const mobile = /Mobile|Android|iPhone/.test(s) ? ' (phone)' : '';
  return `${browser} on ${os}${mobile}`;
}

async function get(username) {
  return cache.get(key(username), CACHE_MS, () => store.getPresence(username));
}

async function put(username, value) {
  await store.setPresence(username, value);
  cache.del(key(username));
  cache.get(key(username), CACHE_MS, () => value);
}

function isOnline(p, now = Date.now()) {
  return !!(p && p.status === 'online' && p.lastSeen && now - new Date(p.lastSeen).getTime() < ONLINE_MS);
}

/** Another device is actively using this account (and it is not this browser). */
async function conflictFor(username, sid) {
  const p = await store.getPresence(username);
  if (!isOnline(p) || (sid && p.sid === sid)) return null;
  return { device: p.device, since: p.loginAt, lastSeen: p.lastSeen };
}

async function login(username, sid, userAgent) {
  const now = new Date().toISOString();
  await put(username, { sid, device: describeDevice(userAgent), loginAt: now, lastSeen: now, logoutAt: null, status: 'online', examId: null, stage: 'home' });
}

async function end(username, sid, status) {
  const p = await store.getPresence(username);
  if (!p || (sid && p.sid !== sid)) return; // a newer session owns the record
  await put(username, { ...p, status, logoutAt: new Date().toISOString() });
}

/**
 * Record activity. Returns false when this session was replaced by a login on
 * another device (the caller then ends the session).
 */
async function touch(username, sid, { stage, examId } = {}) {
  const p = await get(username);
  if (p && p.sid && sid && p.sid !== sid) return false;
  if (!p) return true; // sessions from before presence tracking keep working
  const now = Date.now();
  const stageChanged = (stage && stage !== p.stage) || (examId && examId !== p.examId);
  if (!stageChanged && p.status === 'online' && now - new Date(p.lastSeen).getTime() < WRITE_EVERY_MS) return true;
  await put(username, {
    ...p,
    status: 'online',
    lastSeen: new Date(now).toISOString(),
    ...(stage ? { stage } : {}),
    ...(examId ? { examId } : {}),
  });
  return true;
}

async function list() {
  const now = Date.now();
  return (await store.listPresence()).map((p) => ({ ...p, online: isOnline(p, now) }));
}

module.exports = { describeDevice, conflictFor, login, end, touch, list, isOnline, ONLINE_MS };
