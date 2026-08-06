const express = require('express');
const { body, param } = require('express-validator');
const {
  getKit,
  upsertKit,
  deleteKit,
  getBookings,
  reviewBooking,
  createManagerBooking,
} = require('../controllers/teamKit.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { uploadKitImage } = require('../config/cloudinary');
const { KIT_SIZES } = require('../utils/kitSizes');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

const manage = restrictTo('super_admin', 'academy_admin', 'admin');

// ── الطقم ──
router.get('/', getKit);
router.put(
  '/',
  manage,
  uploadKitImage.single('image'),
  [
    body('name').notEmpty().withMessage('اسم الطقم مطلوب')
      .isLength({ max: 150 }).withMessage('اسم الطقم لا يمكن أن يتجاوز 150 حرف'),
    body('price').notEmpty().withMessage('سعر الطقم مطلوب')
      .isFloat({ min: 0 }).withMessage('سعر الطقم غير صحيح'),
  ],
  validate,
  upsertKit
);
router.delete('/', manage, deleteKit);

// ── الحجوزات ──
router.get('/bookings', getBookings);

router.post(
  '/bookings',
  manage,
  [
    body('playerId').isMongoId().withMessage('معرّف اللاعب غير صحيح'),
    body('shirtName').notEmpty().withMessage('الاسم على التيشرت مطلوب')
      .isLength({ max: 30 }).withMessage('الاسم على التيشرت لا يمكن أن يتجاوز 30 حرف'),
    body('shirtNumber').isInt({ min: 0, max: 999 }).withMessage('الرقم على التيشرت غير صحيح'),
    body('size').isIn(KIT_SIZES).withMessage('المقاس غير صحيح'),
    body('paymentStatus').optional().isIn(['unpaid', 'paid']).withMessage('حالة الدفع غير صحيحة'),
    body('paidAmount').optional().isFloat({ min: 0 }).withMessage('المبلغ المدفوع غير صحيح'),
  ],
  validate,
  createManagerBooking
);

router.patch(
  '/bookings/:id/review',
  manage,
  [
    param('id').isMongoId().withMessage('معرّف الحجز غير صحيح'),
    body('shirtName').optional().isLength({ min: 1, max: 30 })
      .withMessage('الاسم على التيشرت غير صحيح'),
    body('shirtNumber').optional().isInt({ min: 0, max: 999 })
      .withMessage('الرقم على التيشرت غير صحيح'),
    body('size').optional().isIn(KIT_SIZES).withMessage('المقاس غير صحيح'),
    body('paymentStatus').optional().isIn(['unpaid', 'paid']).withMessage('حالة الدفع غير صحيحة'),
    body('paidAmount').optional().isFloat({ min: 0 }).withMessage('المبلغ المدفوع غير صحيح'),
    body('status').optional().isIn(['approved', 'rejected']).withMessage('حالة المراجعة غير صحيحة'),
  ],
  validate,
  reviewBooking
);

module.exports = router;
