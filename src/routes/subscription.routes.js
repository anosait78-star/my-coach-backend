const express = require('express');
const { body, param } = require('express-validator');
const {
  createSubscription,
  updateSubscriptionNotes,
  deleteSubscription,
  getSubscriptionById,
  getSubscriptionsByPlayer,
  getSubscriptionsByAcademy,
  getRevenueSummary,
} = require('../controllers/subscription.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
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
  body('type')
    .notEmpty().withMessage('نوع الاشتراك مطلوب')
    .isIn(['NEW_SUBSCRIPTION', 'RENEWAL']).withMessage('نوع الاشتراك يجب أن يكون NEW_SUBSCRIPTION أو RENEWAL'),
  body('amount')
    .notEmpty().withMessage('مبلغ الاشتراك مطلوب')
    .isNumeric().withMessage('مبلغ الاشتراك يجب أن يكون رقماً')
    .custom((value) => {
      if (parseFloat(value) < 0) throw new Error('مبلغ الاشتراك لا يمكن أن يكون سالباً');
      return true;
    }),
  body('startDate')
    .notEmpty().withMessage('تاريخ بداية الاشتراك مطلوب')
    .isISO8601().withMessage('تاريخ البداية غير صحيح'),
  body('endDate')
    .notEmpty().withMessage('تاريخ نهاية الاشتراك مطلوب')
    .isISO8601().withMessage('تاريخ النهاية غير صحيح')
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.startDate)) {
        throw new Error('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');
      }
      return true;
    }),
  body('notes')
    .optional()
    .isLength({ max: 500 }).withMessage('الملاحظات لا يمكن أن تتجاوز 500 حرف'),
  body('academyId')
    .optional()
    .isMongoId().withMessage('معرّف الأكاديمية غير صحيح'),
];

const notesValidators = [
  body('notes')
    .optional({ nullable: true })
    .isLength({ max: 500 }).withMessage('الملاحظات لا يمكن أن تتجاوز 500 حرف'),
];

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET  /subscriptions/player/:playerId
router.get('/player/:playerId', getSubscriptionsByPlayer);

// GET  /subscriptions/academy/:academyId/revenue — admin blocked
router.get('/academy/:academyId/revenue', restrictTo('super_admin', 'academy_admin'), getRevenueSummary);

// GET  /subscriptions/academy/:academyId — admin blocked (uses player-level access instead)
router.get('/academy/:academyId', restrictTo('super_admin', 'academy_admin'), getSubscriptionsByAcademy);

// GET  /subscriptions/:id
router.get('/:id', getSubscriptionById);

// POST /subscriptions
router.post('/', createValidators, validate, createSubscription);

// PATCH /subscriptions/:id/notes
router.patch('/:id/notes', notesValidators, validate, updateSubscriptionNotes);

// DELETE /subscriptions/:id
router.delete('/:id', deleteSubscription);

module.exports = router;
