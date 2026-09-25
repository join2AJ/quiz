// Writes dist/_redirects for Netlify:
//   /api/*  -> proxied to the backend (BACKEND_URL), so cookies stay same-origin
//   /*      -> index.html, so React Router URLs like /admin/exams/... work on refresh
import fs from 'fs';

const backend = (process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
const lines = [];
if (backend) {
  if (!/^https?:\/\//.test(backend)) {
    console.error(`BACKEND_URL must start with http:// or https:// (got "${backend}")`);
    process.exit(1);
  }
  lines.push(`/api/*  ${backend}/api/:splat  200!`);
} else {
  console.warn('[netlify] BACKEND_URL is not set — the site will load but login and exams will not work.');
}
lines.push('/*  /index.html  200');
fs.writeFileSync('dist/_redirects', `${lines.join('\n')}\n`);
console.log(`[netlify] dist/_redirects:\n${lines.join('\n')}`);
