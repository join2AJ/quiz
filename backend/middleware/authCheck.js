/** Rejects requests without a logged-in session. */
module.exports = function authCheck(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return next();
};
