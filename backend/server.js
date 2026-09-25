const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const config = require('./config');
const store = require('./services/store');
const authCheck = require('./middleware/authCheck');
const roleCheck = require('./middleware/roleCheck');

if (!config.adminPassword) {
  console.warn('[warn] ADMIN_PASSWORD is not set — admin login is disabled. Copy .env.example to .env and set it.');
}
let sessionSecret = config.sessionSecret;
const missingServerlessSecret = config.isServerless && !sessionSecret;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] SESSION_SECRET is not set — using a random secret; everyone is logged out on restart.');
}

const app = express();
app.disable('x-powered-by');
// Number of proxies in front of the app (1 = the host's load balancer; 2 when
// Netlify also proxies /api). Needed so req.ip is the visitor's real IP.
app.set('trust proxy', config.trustProxy);

app.use(express.json({ limit: '3mb' }));
app.use(
  cookieSession({
    name: 'psq_session',
    keys: [sessionSecret],
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: 12 * 60 * 60 * 1000,
  }),
);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
// Only accept JSON bodies on state-changing API calls (blocks cross-site form posts).
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  return next();
});

// Health check: also verifies storage is reachable (Supabase tables exist, etc.).
// On Netlify every function instance would pick its own random secret, so
// logins would randomly break — refuse to run without SESSION_SECRET.
app.use('/api', (req, res, next) => {
  if (missingServerlessSecret && req.path !== '/health') {
    return res.status(503).json({ error: 'SESSION_SECRET is not set. Add it in the Netlify environment variables and redeploy.' });
  }
  return next();
});

app.get('/api/health', async (req, res) => {
  try {
    const info = await store.init();
    res.json({ ok: true, ...info, adminConfigured: !!config.adminPassword, sessionSecretConfigured: !!config.sessionSecret });
  } catch (err) {
    res.status(503).json({ ok: false, store: store.kind, error: err.message, adminConfigured: !!config.adminPassword });
  }
});
app.get('/api/public/settings', async (req, res) => {
  const version = await store.getSetting('logoVersion');
  res.json({ logoUrl: version ? `/api/logo?v=${version}` : null });
});
app.get('/api/logo', async (req, res) => {
  const logo = await store.getLogo();
  if (!logo) return res.status(404).end();
  res.setHeader('Content-Type', logo.type);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(logo.buffer);
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/exam', authCheck, roleCheck('participant'), require('./routes/exam'));
app.use('/api/result', authCheck, roleCheck('participant'), require('./routes/result'));
app.use('/api/admin', authCheck, roleCheck('admin'), require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built React app in production.
if (fs.existsSync(config.frontendDist)) {
  app.use(express.static(config.frontendDist));
  app.get('/*splat', (req, res) => res.sendFile(path.join(config.frontendDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  // 503 = storage not configured/reachable: show the reason so it can be fixed.
  res.status(status).json({ error: status >= 500 && status !== 503 ? 'Something went wrong' : err.message });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`PassSection Quiz API listening on http://localhost:${config.port}`);
    console.log(store.kind === 'supabase' ? 'Storage: Supabase' : `Storage: Excel files in ${config.dataDir}`);
  });
}

module.exports = app;
