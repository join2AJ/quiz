/**
 * Picks the storage driver:
 *   - Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
 *     (required on Netlify, whose filesystem is not persistent);
 *   - otherwise Excel files on disk (local development, Railway/Render with a disk).
 */
const config = require('../../config');

function unavailableStore(message) {
  const fail = async () => {
    const err = new Error(message);
    err.status = 503;
    throw err;
  };
  return new Proxy({ kind: 'unconfigured' }, { get: (target, prop) => (prop in target ? target[prop] : fail) });
}

let store;
if (config.supabaseUrl && config.supabaseKey) {
  store = require('./supabaseStore');
} else if (config.isServerless) {
  store = unavailableStore(
    'Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Netlify environment variables and redeploy.',
  );
} else {
  store = require('./fileStore');
}

module.exports = store;
