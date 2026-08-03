const express = require('express');
const { body } = require('express-validator');
const {
  recordAttendance,
  getAttendance,
  getAttendanceReport,
} = require('../controllers/attendance.controller');
const { protect } = require('../middleware/auth.middleware');
const { blockIfNotWritable } = require('../middleware/subscriptionGuard');
const validate = require('../middleware/validate');

const router = express.Router();

// All routes require authentication
router.use(protect);
// حارس اشتراك المنصة: يمنع الكتابة عند انتهاء/تعليق الاشتراك (لا يمسّ GET).
router.use(blockIfNotWritable);

// ─── Validators ──────────────────────────────────────────────────────────────

const recordValidators = [
  body('code')
    .optional({ checkFalsy: true })
    .isLength({ max: 60 }).withMessage('كود اللاعب غير صحيح'),
  body('playerId')
    .optional({ checkFalsy: true })
    .isMongoId().withMessage('معرّف اللاعب غير صحيح'),
  body('localDate')
    .optional({ checkFalsy: true })
    .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
  body('localTime')
    .optional({ checkFalsy: true })
    .matches(/^\d{2}:\d{2}$/).withMessage('صيغة الوقت غير صحيحة'),
];

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /attendance/report   ← MUST be before any '/:id' style route
router.get('/report', getAttendanceReport);

// GET /attendance
router.get('/', getAttendance);

// POST /attendance
router.post('/', recordValidators, validate, recordAttendance);

module.exports = router;
