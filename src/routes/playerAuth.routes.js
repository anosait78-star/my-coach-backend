const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { playerLogin, playerMe } = require('../controllers/playerAuth.controller');
const { protectPlayer } = require('../middleware/protectPlayer');
const validate = require('../middleware/validate');

const router = express.Router();

// حد صارم لدخول اللاعب: 10 محاولات / 15 دقيقة / IP.
const playerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'تم تجاوز الحد المسموح به من محاولات تسجيل الدخول' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/v1/auth/player/login
router.post(
  '/login',
  playerLoginLimiter,
  [
    body('username').notEmpty().withMessage('اسم المستخدم مطلوب'),
    body('password').notEmpty().withMessage('كلمة المرور مطلوبة'),
  ],
  validate,
  playerLogin
);

// GET /api/v1/auth/player/me
router.get('/me', protectPlayer, playerMe);

module.exports = router;
