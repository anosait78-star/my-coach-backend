const express = require('express');
const { body } = require('express-validator');
const { login, logout, getMe, updateMe, changePassword } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.post('/login', [
  body('email').isEmail().withMessage('البريد الإلكتروني غير صحيح').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('كلمة المرور يجب أن تكون 8 أحرف على الأقل'),
], validate, login);

router.post('/logout', protect, logout);
router.get('/me', protect, getMe);

router.patch('/me', protect, [
  body('name').notEmpty().withMessage('الاسم مطلوب')
    .isLength({ min: 2, max: 100 }).withMessage('الاسم يجب أن يكون بين 2 و 100 حرف'),
], validate, updateMe);

router.patch('/change-password', protect, [
  body('currentPassword').notEmpty().withMessage('كلمة المرور الحالية مطلوبة'),
  body('newPassword').isLength({ min: 8 }).withMessage('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل'),
], validate, changePassword);

module.exports = router;
