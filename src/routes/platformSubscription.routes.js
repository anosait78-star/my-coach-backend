const express = require('express');
const { body, param } = require('express-validator');
const {
  listAcademiesSubscriptions,
  activateSubscription,
  updateSubscription,
  setPlayerPortal,
  getSubscriptionHistory,
} = require('../controllers/platformSubscription.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

// كل المسارات محصورة على super_admin (مالك المنصة).
router.use(protect);
router.use(restrictTo('super_admin'));

const activateValidators = [
  param('academyId').isMongoId().withMessage('معرّف الأكاديمية غير صحيح'),
  body('plan').isIn(['month', 'year']).withMessage('نوع الاشتراك يجب أن يكون month أو year'),
  body('maxPlayers')
    .isInt({ min: 1, max: 1000000 }).withMessage('الحد الأقصى للاعبين غير صحيح'),
  body('playerPortalEnabled').optional().isBoolean().withMessage('قيمة بوابة اللاعب غير صحيحة'),
];

const updateValidators = [
  param('academyId').isMongoId().withMessage('معرّف الأكاديمية غير صحيح'),
  body('plan').optional().isIn(['month', 'year']).withMessage('نوع الاشتراك غير صحيح'),
  body('maxPlayers').optional().isInt({ min: 0, max: 1000000 }).withMessage('الحد الأقصى للاعبين غير صحيح'),
  body('status').optional().isIn(['active', 'suspended', 'expired']).withMessage('حالة الاشتراك غير صحيحة'),
  body('playerPortalEnabled').optional().isBoolean().withMessage('قيمة بوابة اللاعب غير صحيحة'),
];

const portalValidators = [
  param('academyId').isMongoId().withMessage('معرّف الأكاديمية غير صحيح'),
  body('enabled').isBoolean().withMessage('قيمة التفعيل غير صحيحة'),
];

// GET  /platform/subscriptions
router.get('/', listAcademiesSubscriptions);

// GET  /platform/subscriptions/:academyId/history
router.get('/:academyId/history', getSubscriptionHistory);

// POST /platform/subscriptions/:academyId/activate
router.post('/:academyId/activate', activateValidators, validate, activateSubscription);

// PATCH /platform/subscriptions/:academyId/player-portal — تبديل سريع لبوابة اللاعب
router.patch('/:academyId/player-portal', portalValidators, validate, setPlayerPortal);

// PATCH /platform/subscriptions/:academyId
router.patch('/:academyId', updateValidators, validate, updateSubscription);

module.exports = router;
