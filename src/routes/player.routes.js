const express = require('express');
const { body } = require('express-validator');
const {
  getPlayers,
  searchPlayers,
  getPlayerById,
  createPlayer,
  updatePlayer,
  deletePlayer,
  deletePlayerImage,
  changeGroup,
} = require('../controllers/player.controller');
const {
  getPlayerAccount,
  createPlayerAccount,
  changePlayerPassword,
  resetPlayerPassword,
  togglePlayerAccount,
  getAccountStats,
} = require('../controllers/playerAccountAdmin.controller');
const { protect } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');
const { uploadPlayerImage } = require('../config/cloudinary');
const { blockIfNotWritable, enforcePlayerLimit } = require('../middleware/subscriptionGuard');

const router = express.Router();

// All routes require authentication
router.use(protect);

// حارس اشتراك المنصة: يمنع الكتابة عند انتهاء/تعليق الاشتراك (لا يمسّ GET).
router.use(blockIfNotWritable);

// ─── Validators ──────────────────────────────────────────────────────────────

const createValidators = [
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
  body('sport')
    .optional({ checkFalsy: true })
    .isLength({ max: 60 }).withMessage('اسم الرياضة غير صحيح'),
  // المجموعة اختيارية على مستوى الشكل؛ المتحكّم يفرضها فقط إذا كانت الأكاديمية
  // تملك مجموعات لرياضة اللاعب (أكاديمية بلا مجموعات → groupId=null مسموح).
  body('groupId')
    .optional({ checkFalsy: true })
    .isMongoId().withMessage('معرّف المجموعة غير صحيح'),
];

const updateValidators = [
  body('fullName')
    .optional()
    .isLength({ min: 2, max: 150 }).withMessage('الاسم يجب أن يكون بين 2 و 150 حرف'),
  body('birthDate')
    .optional()
    .isDate().withMessage('تاريخ الميلاد غير صحيح'),
  body('parentName')
    .optional()
    .isLength({ min: 2, max: 100 }).withMessage('اسم ولي الأمر يجب أن يكون بين 2 و 100 حرف'),
  body('parentRelationship')
    .optional()
    .isIn(['أب', 'أم', 'أخ', 'أخت', 'جد', 'جدة', 'عم', 'عمة', 'خال', 'خالة', 'وصي'])
    .withMessage('صلة القرابة غير صحيحة'),
  body('parentPhone')
    .optional()
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم الهاتف غير صحيح'),
  body('playerPhone')
    .optional({ checkFalsy: true })
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم هاتف اللاعب غير صحيح'),
  body('sport')
    .optional({ checkFalsy: true })
    .isLength({ max: 60 }).withMessage('اسم الرياضة غير صحيح'),
  body('groupId')
    .optional({ checkFalsy: true })
    .isMongoId().withMessage('معرّف المجموعة غير صحيح'),
];

const changeGroupValidators = [
  body('groupId')
    .notEmpty().withMessage('المجموعة مطلوبة')
    .isMongoId().withMessage('معرّف المجموعة غير صحيح'),
];

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET  /players
router.get('/', getPlayers);

// GET  /players/search?q=...   ← MUST be before /:id to avoid conflict
router.get('/search', searchPlayers);

// GET  /players/account-stats   ← MUST be before /:id to avoid conflict
router.get('/account-stats', getAccountStats);

// GET  /players/:id
router.get('/:id', getPlayerById);

// ─── Player account management (Player Portal) — إضافي بالكامل ──────────────

// GET  /players/:id/account — حالة حساب اللاعب (بدون كلمة مرور)
router.get('/:id/account', getPlayerAccount);

// POST /players/:id/create-account — إنشاء حساب للاعب قائم
router.post('/:id/create-account', createPlayerAccount);

// PATCH /players/:id/password — تغيير كلمة المرور يدوياً
router.patch(
  '/:id/password',
  [
    body('password')
      .isLength({ min: 6, max: 64 }).withMessage('كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
    body('confirmPassword')
      .optional()
      .custom((value, { req }) => value === req.body.password)
      .withMessage('كلمتا المرور غير متطابقتين'),
  ],
  validate,
  changePlayerPassword
);

// PATCH /players/:id/reset-password — توليد كلمة مرور عشوائية جديدة
router.patch('/:id/reset-password', resetPlayerPassword);

// PATCH /players/:id/toggle-account — تفعيل/تعطيل الحساب
router.patch(
  '/:id/toggle-account',
  [body('isActive').isBoolean().withMessage('قيمة التفعيل غير صحيحة')],
  validate,
  togglePlayerAccount
);

// POST /players
router.post(
  '/',
  enforcePlayerLimit, // يمنع تجاوز الحد الأقصى للاعبين (7 أثناء التجربة)
  uploadPlayerImage.single('image'),
  createValidators,
  validate,
  createPlayer
);

// PUT  /players/:id
router.put(
  '/:id',
  uploadPlayerImage.single('image'),
  updateValidators,
  validate,
  updatePlayer
);

// DELETE /players/:id
router.delete('/:id', deletePlayer);

// DELETE /players/:id/image
router.delete('/:id/image', deletePlayerImage);

// PATCH /players/:id/change-group
router.patch('/:id/change-group', changeGroupValidators, validate, changeGroup);

module.exports = router;
