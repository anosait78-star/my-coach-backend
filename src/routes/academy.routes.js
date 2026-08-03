const express = require('express');
const { body } = require('express-validator');
const {
  getAcademies, getAcademyById, createAcademy,
  updateAcademy, deleteAcademy, deleteAcademyLogo,
} = require('../controllers/academy.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');
const { uploadAcademyLogo } = require('../config/cloudinary');

const router = express.Router();

router.use(protect);

const academyValidators = [
  body('name').notEmpty().withMessage('اسم الأكاديمية مطلوب')
    .isLength({ min: 2, max: 150 }).withMessage('الاسم يجب أن يكون بين 2 و 150 حرف'),
  body('phone').notEmpty().withMessage('رقم الهاتف مطلوب')
    .matches(/^[0-9+\-\s()]{7,20}$/).withMessage('رقم الهاتف غير صحيح'),
  body('address').notEmpty().withMessage('العنوان مطلوب')
    .isLength({ max: 300 }).withMessage('العنوان لا يمكن أن يتجاوز 300 حرف'),
  body('currency').optional()
    .isIn(['EGP', 'SAR', 'KWD', 'USD']).withMessage('العملة غير صحيحة'),
  body('websiteUrl').optional({ checkFalsy: true }).isLength({ max: 300 }),
  body('facebookUrl').optional({ checkFalsy: true }).isLength({ max: 300 }),
  body('tiktokUrl').optional({ checkFalsy: true }).isLength({ max: 300 }),
  body('instagramUrl').optional({ checkFalsy: true }).isLength({ max: 300 }),
];

router.route('/')
  .get(getAcademies)
  .post(restrictTo('super_admin'), uploadAcademyLogo.single('logo'), academyValidators, validate, createAcademy);

router.route('/:id')
  .get(getAcademyById)
  .put(uploadAcademyLogo.single('logo'), academyValidators, validate, updateAcademy)
  .delete(restrictTo('super_admin'), deleteAcademy);

router.delete('/:id/logo', deleteAcademyLogo);

module.exports = router;
