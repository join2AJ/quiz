const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const store = require('../services/store');
const { normalizeUsername } = require('../services/excelService');
const audit = require('../services/auditService');
const presence = require('../services/presenceService');

const router = express.Router();

// Hash the env admin password once so admin and participants go through the
// same bcrypt comparison path.
const adminHash = config.adminPassword ? bcrypt.hashSync(config.adminPassword, 10) : null;
const dummyHash = bcrypt.hashSync('not-a-real-password', 10);

// Very small in-memory brute-force guard: 10 failures per IP per 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(ip, { first: Date.now(), count: 1 });
  else f.count += 1;
}

function deviceInfo(req) {
  return String(req.headers['user-agent'] || '').slice(0, 300);
}

function startSession(req, user) {
  const now = Date.now();
  req.session.user = user;
  req.session.sid = crypto.randomUUID();
  req.session.loginAt = now;
  req.session.lastSeen = now;
}

router.post('/login', async (req, res) => {
  // On Netlify, x-nf-client-connection-ip is set by Netlify's edge to the visitor's IP.
  const ip = (config.isServerless && req.headers['x-nf-client-connection-ip']) || req.ip;
  const username = normalizeUsername(req.body && req.body.username).slice(0, 100);
  const password = String((req.body && req.body.password) || '');
  const attempt = (success, reason) =>
    audit.log(req, 'LOGIN_ATTEMPT', {
      username,
      user_agent: deviceInfo(req),
      success_flag: success,
      failure_reason: reason,
    });

  if (tooManyFailures(ip)) {
    await attempt(false, 'rate_limited');
    return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }
  const invalid = async (reason) => {
    recordFailure(ip);
    await attempt(false, reason);
    return res.status(401).json({ error: 'Invalid credentials' });
  };
  if (!username || !password) return invalid('missing_fields');

  let user;
  if (username === config.adminUsername) {
    // Without ADMIN_PASSWORD set, admin login is disabled.
    const ok = await bcrypt.compare(password, adminHash || dummyHash);
    if (!adminHash) return invalid('admin_password_not_configured');
    if (!ok) return invalid('wrong_password');
    user = { username: 'admin', name: 'Administrator', role: 'admin' };
  } else {
    const found = await store.getUser(username);
    const ok = await bcrypt.compare(password, found ? found.passwordHash : dummyHash);
    if (!found) return invalid('unknown_user');
    if (!ok) return invalid('wrong_password');
    user = { username: found.username, name: found.name, nameHi: found.nameHi || '', role: 'participant' };
  }

  // One device at a time: if this account is active on another device, ask
  // first; logging in here then ends the other session.
  if (user.role === 'participant') {
    const conflict = await presence.conflictFor(user.username, req.session && req.session.sid);
    if (conflict && !(req.body && req.body.force === true)) {
      failures.delete(ip);
      await audit.log(req, 'LOGIN_CONFLICT', { username: user.username, other_device: conflict.device, new_device: presence.describeDevice(deviceInfo(req)) });
      return res.status(409).json({ code: 'ALREADY_LOGGED_IN', error: 'Already logged in on another device', device: conflict.device, since: conflict.since });
    }
    if (conflict) {
      await audit.log(req, 'SESSION_REPLACED', { username: user.username, old_device: conflict.device, new_device: presence.describeDevice(deviceInfo(req)) });
    }
  }

  startSession(req, user);
  if (user.role === 'participant') await presence.login(user.username, req.session.sid, deviceInfo(req));
  failures.delete(ip);
  await attempt(true, null);
  await audit.log(req, 'LOGIN_SUCCESS', {
    username: user.username,
    role: user.role,
    session_id: req.session.sid,
    device_info: deviceInfo(req),
  });
  return res.json({ user });
});

router.post('/logout', async (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'participant') await presence.end(req.session.user.username, req.session.sid, 'logged_out');
    await audit.log(req, 'LOGOUT', {
      username: req.session.user.username,
      session_duration_seconds: req.session.loginAt ? Math.round((Date.now() - req.session.loginAt) / 1000) : null,
    });
  }
  req.session = null;
  res.json({ ok: true });
});

// Heartbeat from logged-in pages: keeps "online" accurate and tells a browser
// whose session was replaced by a login on another device.
router.post('/ping', async (req, res) => {
  const s = req.session;
  if (!s || !s.user) return res.status(401).json({ error: 'Not authenticated' });
  if (s.user.role === 'participant') {
    const stage = ['home', 'waiting', 'exam', 'review', 'submitted', 'result'].includes(req.body && req.body.stage) ? req.body.stage : undefined;
    const examId = typeof (req.body && req.body.examId) === 'string' ? req.body.examId.slice(0, 40) : undefined;
    await presence.touch(s.user.username, s.sid, { stage, examId });
  }
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: (req.session && req.session.user) || null });
});

module.exports = router;
