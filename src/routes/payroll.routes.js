const express = require('express');
const { body, query } = require('express-validator');
const {
  generatePayroll,
  getPayrollList,
  getPayrollReport,
  markPaid,
} = require('../controllers/payroll.controller');
const { protect, restrictTo, requireReportsAccess } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);
router.use(restrictTo('super_admin', 'academy_admin'));
// الرواتب بيانات مالية: تُحجب عن الحسابات الإدارية المحدودة (canViewReports=false)
// مهما كان دورها — نفس قاعدة الإحصائيات والتقارير.
router.use(requireReportsAccess);
// حارس اشتراك المنصة: يمنع الكتابة عند انتهاء/تعليق الاشتراك (لا يمسّ GET).

const generateValidators = [
  body('month').notEmpty().withMessage('الشهر مطلوب').matches(/^\d{4}-\d{2}$/).withMessage('صيغة الشهر غير صحيحة'),
  body('staffId').optional().isMongoId().withMessage('معرّف الموظف غير صحيح'),
];

const reportValidators = [
  query('month').notEmpty().withMessage('الشهر مطلوب').matches(/^\d{4}-\d{2}$/).withMessage('صيغة الشهر غير صحيحة'),
];

router.post('/generate', generateValidators, validate, generatePayroll);
router.get('/report', reportValidators, validate, getPayrollReport);
router.get('/', getPayrollList);
router.patch('/:id/mark-paid', markPaid);

module.exports = router;
