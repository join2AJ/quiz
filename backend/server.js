const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const config = require('./config');
const excel = require('./services/excelService');
const authCheck = require('./middleware/authCheck');
const roleCheck = require('./middleware/roleCheck');

if (!config.adminPassword) {
  console.warn('[warn] ADMIN_PASSWORD is not set — admin login is disabled. Copy .env.example to .env and set it.');
}
let sessionSecret = config.sessionSecret;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[warn] SESSION_SECRET is not set — using a random secret; everyone is logged out on restart.');
}

excel.ensureDirs();

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

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/public/settings', (req, res) => {
  const version = excel.getSetting('logoVersion');
  res.json({ logoUrl: version ? `/api/logo?v=${version}` : null });
});
app.get('/api/logo', (req, res) => {
  const type = excel.getSetting('logoType');
  if (!type || !fs.existsSync(config.logoFile)) return res.status(404).end();
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(fs.readFileSync(config.logoFile));
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
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`PassSection Quiz API listening on http://localhost:${config.port}`);
    console.log(`Data directory: ${config.dataDir}`);
  });
}

module.exports = app;
