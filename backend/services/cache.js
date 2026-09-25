/**
 * Tiny in-memory cache for data that does not change during an exam (the exam
 * record, the question bank, assignments). It cuts database round trips per
 * answer click, which matters on serverless hosts far from the database.
 * Each server/function instance has its own copy; entries expire after `ttl`,
 * and admin changes clear the local copy immediately.
 */
const entries = new Map(); // key -> { expires, promise }

function get(key, ttlMs, loader) {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expires > now) return hit.promise;
  const promise = Promise.resolve()
    .then(loader)
    .catch((err) => {
      entries.delete(key); // never cache failures
      throw err;
    });
  entries.set(key, { expires: now + ttlMs, promise });
  return promise;
}

function clear() {
  entries.clear();
}

module.exports = { get, clear };
