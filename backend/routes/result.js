const express = require('express');
const store = require('../services/store');
const scoring = require('../services/scoringService');
const audit = require('../services/auditService');
const { publicExam, isUnlocked, attemptInfo } = require('./exam');

const router = express.Router();

/**
 * Result card data. The participant version leaves out integrity signals and
 * concern counts (admin-only); neither version contains the answer key.
 */
function resultCard(exam, attempt, { admin = false } = {}) {
  const { integrity, concernCount, ...r } = attempt.result;
  const card = { ...r, dimensions: r.dimensions || [], remarks: scoring.remarksFor(attempt.result, exam) };
  return admin ? { ...card, integrity, concernCount } : card;
}

// Participant: only their own result, only after the unlock date.
router.get('/:id', async (req, res) => {
  const { username } = req.session.user;
  const [exam, assigned, attempt] = await Promise.all([
    store.getExam(req.params.id),
    store.isAssigned(req.params.id, username),
    store.getAttempt(req.params.id, username),
  ]);
  if (!exam || !assigned) return res.status(404).json({ error: 'Not found' });
  if (!attempt || attempt.status !== 'submitted' || !attempt.result) {
    return res.status(404).json({ error: 'No submission found' });
  }
  const info = attemptInfo(exam, attempt);
  const base = {
    exam: publicExam(exam),
    attempt: info,
    name: attempt.result.name,
    nameHi: attempt.result.nameHi || '',
    serverTime: new Date().toISOString(),
  };
  const unlocked = isUnlocked(exam, attempt);
  await audit.log(req, 'RESULT_VIEW', {
    username,
    exam_id: exam.id,
    days_since_submission: Math.floor((Date.now() - new Date(attempt.submittedAt).getTime()) / 86400000),
    result_was_available: unlocked,
  });
  if (!unlocked) return res.json({ ...base, locked: true });
  return res.json({ ...base, locked: false, result: resultCard(exam, attempt) });
});

module.exports = router;
module.exports.resultCard = resultCard;
