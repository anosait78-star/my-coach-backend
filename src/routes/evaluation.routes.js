const express = require('express');
const { body, param } = require('express-validator');
const {
  createEvaluation,
  getEvaluationsByPlayer,
  getLatestEvaluation,
  getEvaluationById,
  updateEvaluation,
  deleteEvaluation,
  getEvaluationsByAcademy,
} = require('../controllers/evaluation.controller');
const { protect } = require('../middleware/auth.middleware');
const { blockIfNotWritable } = require('../middleware/subscriptionGuard');
const validate = require('../middleware/validate');

const router = express.Router();

// All routes require authentication
router.use(protect);
// حارس اشتراك المنصة: يمنع الكتابة عند انتهاء/تعليق الاشتراك (لا يمسّ GET).
router.use(blockIfNotWritable);

// ─── Validators ──────────────────────────────────────────────────────────────

const createValidators = [
  body('playerId')
    .notEmpty().withMessage('معرّف اللاعب مطلوب')
    .isMongoId().withMessage('معرّف اللاعب غير صحيح'),
  body('evaluationDate')
    .optional()
    .isISO8601().withMessage('تاريخ التقييم غير صحيح'),
  body('fitness')
    .notEmpty().withMessage('تقييم اللياقة مطلوب')
    .isFloat({ min: 1, max: 10 }).withMessage('تقييم اللياقة يجب أن يكون بين 1 و 10'),
  body('basicSkills')
    .notEmpty().withMessage('تقييم المهارات الأساسية مطلوب')
    .isFloat({ min: 1, max: 10 }).withMessage('تقييم المهارات الأساسية يجب أن يكون بين 1 و 10'),
  body('attack')
    .notEmpty().withMessage('تقييم الهجوم مطلوب')
    .isFloat({ min: 1, max: 10 }).withMessage('تقييم الهجوم يجب أن يكون بين 1 و 10'),
  body('defense')
    .notEmpty().withMessage('تقييم الدفاع مطلوب')
    .isFloat({ min: 1, max: 10 }).withMessage('تقييم الدفاع يجب أن يكون بين 1 و 10'),
  body('commitment')
    .notEmpty().withMessage('تقييم الالتزام مطلوب')
    .isFloat({ min: 1, max: 10 }).withMessage('تقييم الالتزام يجب أن يكون بين 1 و 10'),
];

const updateValidators = [
  body('evaluationDate')
    .optional()
    .isISO8601().withMessage('تاريخ التقييم غير صحيح'),
  body('fitness')
    .optional()
    .isFloat({ min: 1, max: 10 }).withMessage('تقييم اللياقة يجب أن يكون بين 1 و 10'),
  body('basicSkills')
    .optional()
    .isFloat({ min: 1, max: 10 }).withMessage('تقييم المهارات الأساسية يجب أن يكون بين 1 و 10'),
  body('attack')
    .optional()
    .isFloat({ min: 1, max: 10 }).withMessage('تقييم الهجوم يجب أن يكون بين 1 و 10'),
  body('defense')
    .optional()
    .isFloat({ min: 1, max: 10 }).withMessage('تقييم الدفاع يجب أن يكون بين 1 و 10'),
  body('commitment')
    .optional()
    .isFloat({ min: 1, max: 10 }).withMessage('تقييم الالتزام يجب أن يكون بين 1 و 10'),
];

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET  /evaluations/player/:playerId            — paginated list
router.get('/player/:playerId', getEvaluationsByPlayer);

// GET  /evaluations/player/:playerId/latest     — MUST be before /:id
router.get('/player/:playerId/latest', getLatestEvaluation);

// GET  /evaluations/academy/:academyId     — MUST be before /:id
router.get('/academy/:academyId', getEvaluationsByAcademy);

// GET  /evaluations/:id
router.get('/:id', getEvaluationById);

// POST /evaluations
router.post('/', createValidators, validate, createEvaluation);

// PUT  /evaluations/:id
router.put('/:id', updateValidators, validate, updateEvaluation);

// DELETE /evaluations/:id
router.delete('/:id', deleteEvaluation);

module.exports = router;
