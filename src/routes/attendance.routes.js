const express = require('express');
const { body, param } = require('express-validator');
const {
  recordAttendance,
  getAttendance,
  getAttendanceReport,
  searchAttendancePlayers,
  getPlayerAttendanceSummary,
  getPlayerAttendanceCalendar,
  deleteAttendance,
} = require('../controllers/attendance.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

// All routes require authentication
router.use(protect);

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
  // نوع الحضور للاعب منتهي الاشتراك (يُتجاهل لو الاشتراك نشط).
  body('mode')
    .optional({ checkFalsy: true })
    .isIn(['pay_later', 'makeup', 'free']).withMessage('نوع الحضور غير صحيح'),
];

const idParam = (name) => [param(name).isMongoId().withMessage('المعرّف غير صحيح')];

// ─── Routes ──────────────────────────────────────────────────────────────────
// الترتيب مهم: /report و /players و /player/:id/summary قبل أي مسار '/:id'.

// GET /attendance/report
router.get('/report', getAttendanceReport);

// GET /attendance/players?search=&sport=
router.get('/players', searchAttendancePlayers);

// GET /attendance/player/:id/summary
router.get('/player/:id/summary', idParam('id'), validate, getPlayerAttendanceSummary);

// GET /attendance/player/:id/calendar
router.get('/player/:id/calendar', idParam('id'), validate, getPlayerAttendanceCalendar);

// GET /attendance
router.get('/', getAttendance);

// POST /attendance
router.post('/', recordValidators, validate, recordAttendance);

// DELETE /attendance/:id — حذف سجل حضور (الإدارة فقط)
router.delete(
  '/:id',
  restrictTo('super_admin', 'academy_admin', 'admin'),
  idParam('id'),
  validate,
  deleteAttendance
);

module.exports = router;
