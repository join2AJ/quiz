/** Allows the request only if the session user has one of the given roles. */
module.exports = function roleCheck(...roles) {
  return function checkRole(req, res, next) {
    const user = req.session && req.session.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'Forbidden' });
    return next();
  };
};
