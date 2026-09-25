const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

const config = {
  port: Number(process.env.PORT) || 4000,
  isProduction: process.env.NODE_ENV === 'production',
  // HTTPS-only cookies in production; set COOKIE_SECURE=false to run over plain HTTP (e.g. a LAN IP).
  cookieSecure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
  trustProxy: process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : process.env.NODE_ENV === 'production' ? 1 : 0,
  adminUsername: 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  dataDir: DATA_DIR,
  appFile: path.join(DATA_DIR, 'app.xlsx'),
  examsDir: path.join(DATA_DIR, 'exams'),
  attemptsDir: path.join(DATA_DIR, 'attempts'),
  logoFile: path.join(DATA_DIR, 'logo.bin'),
  frontendDist: path.join(__dirname, '..', 'frontend', 'dist'),
  defaultUnlockDays: 10,
  defaultThresholds: {
    excellent: 85,
    good: 70,
    fair: 50,
    knowledge: 70,
    behaviour: 70,
    gap: 20,
  },
};

module.exports = config;
