const express = require('express');
const { body, query } = require('express-validator');
const {
  markAttendance,
  getAttendanceHistory,
  getAttendanceReport,
} = require('../controllers/staffAttendance.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { blockIfNotWritable } = require('../middleware/subscriptionGuard');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);
router.use(restrictTo('academy_admin'));
// حارس اشتراك المنصة: يمنع الكتابة عند انتهاء/تعليق الاشتراك (لا يمسّ GET).
router.use(blockIfNotWritable);

const markValidators = [
  body('staffId').notEmpty().withMessage('معرّف الموظف مطلوب').isMongoId().withMessage('معرّف الموظف غير صحيح'),
  body('date').notEmpty().withMessage('التاريخ مطلوب').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
  body('status').notEmpty().withMessage('حالة الحضور مطلوبة').isIn(['present', 'absent']).withMessage('حالة الحضور غير صحيحة'),
  body('notes').optional({ checkFalsy: true }).isLength({ max: 300 }).withMessage('الملاحظات لا يمكن أن تتجاوز 300 حرف'),
];

const reportValidators = [
  query('startDate').notEmpty().withMessage('تاريخ البداية مطلوب').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
  query('endDate').notEmpty().withMessage('تاريخ النهاية مطلوب').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
];

// GET /staff-attendance/report — must be before any /:id-style route
router.get('/report', reportValidators, validate, getAttendanceReport);

router.get('/', getAttendanceHistory);
router.post('/', markValidators, validate, markAttendance);

module.exports = router;
