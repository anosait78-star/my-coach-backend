const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { createJoinRequest } = require('../controllers/player.controller');
const validate = require('../middleware/validate');
const { uploadJoinRequestFiles } = require('../config/cloudinary');

const router = express.Router();

// حد صارم لمنع إساءة استخدام التسجيل الذاتي: 5 محاولات / 15 دقيقة / IP.
// هذا الراوتر عام بالكامل (بلا protect) — مُمسَّم لمسار /join-request فقط
// ومُركَّب قبل player.routes.js (المحمي بالكامل) في server.js.
const joinRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'تم تجاوز الحد المسموح به من محاولات إرسال طلب الانضمام' },
  standardHeaders: true,
  legacyHeaders: false,
});

const joinRequestValidators = [
  body('academyId')
    .notEmpty().withMessage('الفرع مطلوب')
    .isMongoId().withMessage('الفرع المختار غير صحيح'),
  body('fullName')
    .notEmpty().withMessage('الاسم الكامل مطلوب')
    .isLength({ min: 2, max: 150 }).withMessage('الاسم يجب أن يكون بين 2 و 150 حرف'),
  body('birthDate')
    .notEmpty().withMessage('تاريخ الميلاد مطلوب')
    .isDate().withMessage('تاريخ الميلاد غير صحيح'),
  body('parentName')
    .notEmpty().withMessage('اسم ولي الأمر مطلوب')
    .isLength({ min: 2, max: 100 }).withMessage('اسم ولي الأمر يجب أن يكون بين 2 و 100 حرف'),
  body('parentRelationship')
    .notEmpty().withMessage('صلة القرابة مطلوبة')
    .isIn(['أب', 'أم', 'أخ', 'أخت', 'جد', 'جدة', 'عم', 'عمة', 'خال', 'خالة', 'وصي'])
    .withMessage('صلة القرابة غير صحيحة'),
  body('parentPhone')
    .notEmpty().withMessage('رقم هاتف ولي الأمر مطلوب')
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم الهاتف غير صحيح'),
  body('playerPhone')
    .optional({ checkFalsy: true })
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم هاتف اللاعب غير صحيح'),
  body('branch')
    .notEmpty().withMessage('الفرع مطلوب')
    .isLength({ max: 100 }).withMessage('اسم الفرع غير صحيح'),
  body('loginPhone')
    .notEmpty().withMessage('رقم الهاتف (لتسجيل الدخول) مطلوب')
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم الهاتف غير صحيح'),
  body('password')
    .isLength({ min: 8 }).withMessage('كلمة المرور يجب أن تكون 8 أحرف على الأقل'),
];

// POST /api/v1/players/join-request  (عام — بلا تسجيل دخول)
router.post(
  '/join-request',
  joinRequestLimiter,
  uploadJoinRequestFiles,
  joinRequestValidators,
  validate,
  createJoinRequest
);

module.exports = router;
