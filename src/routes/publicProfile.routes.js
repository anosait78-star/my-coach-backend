const express = require('express');
const rateLimit = require('express-rate-limit');
const { getPublicProfile } = require('../controllers/publicProfile.controller');

const router = express.Router();

// مسار عام بلا توكن — حد طلبات بسيط يصعّب تجربة الرموز عشوائياً.
router.use(rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

// GET /api/v1/public/players/:token
router.get('/players/:token', getPublicProfile);

module.exports = router;
