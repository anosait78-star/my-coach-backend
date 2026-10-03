const express = require('express');
const { body } = require('express-validator');
const {
  getStaff,
  getStaffById,
  createStaff,
  updateStaff,
  deleteStaff,
} = require('../controllers/staff.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');
const { uploadStaffPhoto } = require('../config/cloudinary');
const Staff = require('../models/staff.model');

const router = express.Router();

router.use(protect);
router.use(restrictTo('super_admin', 'academy_admin'));
// حارس اشتراك المنصة: يمنع الكتابة عند انتهاء/تعليق الاشتراك (لا يمسّ GET).

// الحسابات الإدارية المحدودة لا ترسل حقولاً مالية أصلاً، فلا تُطالَب بها.
const salaryVisible = (value, { req }) => req.user?.canViewReports !== false;

const createValidators = [
  body('fullName')
    .notEmpty().withMessage('اسم الموظف مطلوب')
    .isLength({ min: 2, max: 150 }).withMessage('الاسم يجب أن يكون بين 2 و 150 حرف'),
  body('position')
    .notEmpty().withMessage('الوظيفة مطلوبة')
    .isLength({ max: 100 }).withMessage('الوظيفة لا يمكن أن تتجاوز 100 حرف'),
  body('phone')
    .notEmpty().withMessage('رقم الهاتف مطلوب')
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم الهاتف غير صحيح'),
  body('email')
    .optional({ checkFalsy: true })
    .isEmail().withMessage('البريد الإلكتروني غير صحيح'),
  body('hireDate')
    .notEmpty().withMessage('تاريخ التعيين مطلوب')
    .isDate().withMessage('تاريخ التعيين غير صحيح'),
  // المرتب = سعر التمرينة × أيام الحضور (لكل الموظفين).
  body('sessionRate')
    .if(salaryVisible)
    .notEmpty().withMessage('سعر التمرينة مطلوب')
    .isFloat({ min: 0 }).withMessage('سعر التمرينة غير صحيح'),
  body('workingDays').custom((value) => {
    const arr = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
    if (!arr || arr.length === 0) throw new Error('أيام العمل مطلوبة');
    const invalid = arr.map((s) => String(s).trim()).filter((d) => !Staff.WEEKDAYS.includes(d));
    if (invalid.length > 0) throw new Error('أيام العمل غير صحيحة');
    return true;
  }),
];

const updateValidators = [
  body('fullName').optional().isLength({ min: 2, max: 150 }).withMessage('الاسم يجب أن يكون بين 2 و 150 حرف'),
  body('position').optional().isLength({ max: 100 }).withMessage('الوظيفة لا يمكن أن تتجاوز 100 حرف'),
  body('phone').optional().matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم الهاتف غير صحيح'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('البريد الإلكتروني غير صحيح'),
  body('hireDate').optional().isDate().withMessage('تاريخ التعيين غير صحيح'),
  body('sessionRate').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('سعر التمرينة غير صحيح'),
];

router.get('/', getStaff);
router.get('/:id', getStaffById);
router.post('/', uploadStaffPhoto.single('photo'), createValidators, validate, createStaff);
router.put('/:id', uploadStaffPhoto.single('photo'), updateValidators, validate, updateStaff);
router.delete('/:id', deleteStaff);

module.exports = router;
