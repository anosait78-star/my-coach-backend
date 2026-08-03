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
const { blockIfNotWritable } = require('../middleware/subscriptionGuard');
const validate = require('../middleware/validate');
const { uploadStaffPhoto } = require('../config/cloudinary');
const Staff = require('../models/staff.model');

const router = express.Router();

router.use(protect);
router.use(restrictTo('academy_admin'));
// حارس اشتراك المنصة: يمنع الكتابة عند انتهاء/تعليق الاشتراك (لا يمسّ GET).
router.use(blockIfNotWritable);

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
  body('baseSalary')
    .optional({ checkFalsy: true })
    .isFloat({ min: 0 }).withMessage('الراتب الأساسي غير صحيح'),
  body('monthlyAttendanceTarget')
    .notEmpty().withMessage('عدد أيام الحضور المطلوبة مطلوب')
    .isInt({ min: 1 }).withMessage('عدد أيام الحضور المطلوبة غير صحيح'),
  body('deductionType')
    .notEmpty().withMessage('نوع الخصم مطلوب')
    .isIn(['percentage', 'fixed']).withMessage('نوع الخصم غير صحيح'),
  body('deductionValue')
    .notEmpty().withMessage('قيمة الخصم مطلوبة')
    .isFloat({ min: 0 }).withMessage('قيمة الخصم غير صحيحة')
    .custom((value, { req }) => {
      if (req.body.deductionType === 'percentage' && Number(value) > 100) {
        throw new Error('نسبة الخصم لا يمكن أن تتجاوز 100%');
      }
      return true;
    }),
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
  body('baseSalary').optional({ checkFalsy: true }).isFloat({ min: 0 }).withMessage('الراتب الأساسي غير صحيح'),
  body('monthlyAttendanceTarget').optional().isInt({ min: 1 }).withMessage('عدد أيام الحضور المطلوبة غير صحيح'),
  body('deductionType').optional().isIn(['percentage', 'fixed']).withMessage('نوع الخصم غير صحيح'),
  body('deductionValue').optional().isFloat({ min: 0 }).withMessage('قيمة الخصم غير صحيحة'),
];

router.get('/', getStaff);
router.get('/:id', getStaffById);
router.post('/', uploadStaffPhoto.single('photo'), createValidators, validate, createStaff);
router.put('/:id', uploadStaffPhoto.single('photo'), updateValidators, validate, updateStaff);
router.delete('/:id', deleteStaff);

module.exports = router;
