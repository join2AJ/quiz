const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

function unquote(v) {
  return String(v || '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim();
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));

const config = {
  port: Number(process.env.PORT) || 4000,
  isProduction: process.env.NODE_ENV === 'production',
  // HTTPS-only cookies in production; set COOKIE_SECURE=false to run over plain HTTP (e.g. a LAN IP).
  cookieSecure:
    (process.env.NODE_ENV === 'production' || !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME)) &&
    process.env.COOKIE_SECURE !== 'false',
  trustProxy: process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : process.env.NODE_ENV === 'production' ? 1 : 0,
  adminUsername: 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  // Tolerate values pasted with surrounding quotes/spaces, or with a trailing /rest/v1.
  // Host names are case-insensitive, so lower-case the URL.
  supabaseUrl: unquote(process.env.SUPABASE_URL).toLowerCase().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''),
  // Keys never contain whitespace; remove any line breaks/spaces picked up while copying.
  supabaseKey: unquote(process.env.SUPABASE_SERVICE_ROLE_KEY).replace(/^Bearer\s+/i, '').replace(/\s+/g, ''),
  supabaseKeyRaw: String(process.env.SUPABASE_SERVICE_ROLE_KEY || ''),
  // Netlify Functions / AWS Lambda: no persistent disk, one request at a time per instance.
  isServerless: !!(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT),
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
