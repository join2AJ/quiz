// Netlify Function that runs the whole Express API. netlify.toml rewrites
// /api/* here. Data lives in Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
const serverless = require('serverless-http');
const app = require('../../backend/server');

const handler = serverless(app, {
  // Excel downloads and the logo are binary.
  binary: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/*'],
  request(req) {
    // Depending on how the rewrite is applied, the path may arrive as the
    // function path; the Express routes expect /api/...
    if (req.url.startsWith('/.netlify/functions/api')) {
      req.url = `/api${req.url.slice('/.netlify/functions/api'.length)}`;
    }
  },
});

exports.handler = (event, context) => handler(event, context);
