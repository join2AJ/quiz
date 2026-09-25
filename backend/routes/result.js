const express = require('express');
const excel = require('../services/excelService');
const scoring = require('../services/scoringService');
const { publicExam, isUnlocked, attemptInfo } = require('./exam');

const router = express.Router();

/** Result card data (no answer key, no per-question correctness). */
function resultCard(exam, attempt) {
  const r = attempt.result;
  return {
    ...r,
    remarks: scoring.remarks(r.totalPct, r.knowledgePct, r.behaviourPct, exam.thresholds),
  };
}

// Participant: only their own result, only after the unlock date.
router.get('/:id', (req, res) => {
  const { username } = req.session.user;
  const exam = excel.getExam(req.params.id);
  if (!exam || !excel.isAssigned(exam.id, username)) return res.status(404).json({ error: 'Not found' });
  const attempt = excel.getAttempt(exam.id, username);
  if (!attempt || attempt.status !== 'submitted' || !attempt.result) {
    return res.status(404).json({ error: 'No submission found' });
  }
  const info = attemptInfo(exam, attempt);
  const base = { exam: publicExam(exam), attempt: info, name: attempt.result.name, serverTime: new Date().toISOString() };
  if (!isUnlocked(exam, attempt)) return res.json({ ...base, locked: true });
  return res.json({ ...base, locked: false, result: resultCard(exam, attempt) });
});

module.exports = router;
module.exports.resultCard = resultCard;
