const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const store = require('../services/store');
const { normalizeUsername } = require('../services/excelService');

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

router.post('/login', async (req, res) => {
  // On Netlify, x-nf-client-connection-ip is set by Netlify's edge to the visitor's IP.
  const ip = (config.isServerless && req.headers['x-nf-client-connection-ip']) || req.ip;
  if (tooManyFailures(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  }
  const username = normalizeUsername(req.body && req.body.username);
  const password = String((req.body && req.body.password) || '');
  const invalid = () => {
    recordFailure(ip);
    return res.status(401).json({ error: 'Invalid credentials' });
  };
  if (!username || !password) return invalid();

  if (username === config.adminUsername) {
    // Without ADMIN_PASSWORD set, admin login is disabled.
    const ok = await bcrypt.compare(password, adminHash || dummyHash);
    if (!adminHash || !ok) return invalid();
    req.session.user = { username: 'admin', name: 'Administrator', role: 'admin' };
    failures.delete(ip);
    return res.json({ user: req.session.user });
  }

  const user = await store.getUser(username);
  const ok = await bcrypt.compare(password, user ? user.passwordHash : dummyHash);
  if (!user || !ok) return invalid();
  req.session.user = { username: user.username, name: user.name, role: 'participant' };
  failures.delete(ip);
  return res.json({ user: req.session.user });
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: (req.session && req.session.user) || null });
});

module.exports = router;
