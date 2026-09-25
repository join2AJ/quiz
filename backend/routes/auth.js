const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const store = require('../services/store');
const { normalizeUsername } = require('../services/excelService');
const audit = require('../services/auditService');

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

  startSession(req, user);
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
    await audit.log(req, 'LOGOUT', {
      username: req.session.user.username,
      session_duration_seconds: req.session.loginAt ? Math.round((Date.now() - req.session.loginAt) / 1000) : null,
    });
  }
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: (req.session && req.session.user) || null });
});

module.exports = router;
