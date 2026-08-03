const express = require('express');
const { body, param } = require('express-validator');
const {
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
  activateUser,
  deactivateUser,
  getUsersByAcademy,
  getUserById,
} = require('../controllers/user.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

// ─── Validators ──────────────────────────────────────────────────────────────

const createUserValidators = [
  body('name')
    .notEmpty().withMessage('الاسم مطلوب')
    .isLength({ min: 2, max: 100 }).withMessage('الاسم يجب أن يكون بين 2 و 100 حرف'),
  body('email')
    .notEmpty().withMessage('البريد الإلكتروني مطلوب')
    .isEmail().withMessage('صيغة البريد الإلكتروني غير صحيحة')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('كلمة المرور مطلوبة')
    .isLength({ min: 8 }).withMessage('كلمة المرور يجب أن تكون 8 أحرف على الأقل'),
  body('academyId')
    .notEmpty().withMessage('معرف الأكاديمية مطلوب')
    .isMongoId().withMessage('معرف الأكاديمية غير صحيح'),
  body('role')
    .optional()
    .isIn(['academy_admin', 'admin']).withMessage('الدور غير صحيح'),
];

const updateUserValidators = [
  body('name')
    .optional()
    .isLength({ min: 2, max: 100 }).withMessage('الاسم يجب أن يكون بين 2 و 100 حرف'),
  body('email')
    .optional()
    .isEmail().withMessage('صيغة البريد الإلكتروني غير صحيحة')
    .normalizeEmail(),
];

const mongoIdParam = (paramName) =>
  param(paramName).isMongoId().withMessage(`معرف ${paramName} غير صحيح`);

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/v1/users/academy/:academyId — protected; role-scoped in controller
router.get(
  '/academy/:academyId',
  protect,
  mongoIdParam('academyId'),
  validate,
  getUsersByAcademy
);

// GET /api/v1/users/:id — protected
router.get(
  '/:id',
  protect,
  mongoIdParam('id'),
  validate,
  getUserById
);

// POST /api/v1/users — super_admin only
router.post(
  '/',
  protect,
  restrictTo('super_admin'),
  createUserValidators,
  validate,
  createUser
);

// PUT /api/v1/users/:id — super_admin only
router.put(
  '/:id',
  protect,
  restrictTo('super_admin'),
  mongoIdParam('id'),
  updateUserValidators,
  validate,
  updateUser
);

// PATCH /api/v1/users/:id/reset-password — super_admin only
router.patch(
  '/:id/reset-password',
  protect,
  restrictTo('super_admin'),
  mongoIdParam('id'),
  body('newPassword')
    .notEmpty().withMessage('كلمة المرور الجديدة مطلوبة')
    .isLength({ min: 8 }).withMessage('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل'),
  validate,
  resetUserPassword
);

// DELETE /api/v1/users/:id — super_admin only (soft delete)
router.delete(
  '/:id',
  protect,
  restrictTo('super_admin'),
  mongoIdParam('id'),
  validate,
  deleteUser
);

// PATCH /api/v1/users/:id/activate — super_admin only
router.patch(
  '/:id/activate',
  protect,
  restrictTo('super_admin'),
  mongoIdParam('id'),
  validate,
  activateUser
);

// PATCH /api/v1/users/:id/deactivate — super_admin only
router.patch(
  '/:id/deactivate',
  protect,
  restrictTo('super_admin'),
  mongoIdParam('id'),
  validate,
  deactivateUser
);

module.exports = router;
