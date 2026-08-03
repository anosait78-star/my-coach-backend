const express = require('express');
const { body, query } = require('express-validator');
const {
  getExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseReport,
} = require('../controllers/expense.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { blockIfNotWritable } = require('../middleware/subscriptionGuard');
const validate = require('../middleware/validate');
const Expense = require('../models/expense.model');

const router = express.Router();

router.use(protect);
router.use(restrictTo('academy_admin'));
// حارس اشتراك المنصة: يمنع الكتابة عند انتهاء/تعليق الاشتراك (لا يمسّ GET).
router.use(blockIfNotWritable);

const createValidators = [
  body('name').notEmpty().withMessage('اسم المصروف مطلوب').isLength({ max: 150 }).withMessage('اسم المصروف طويل جداً'),
  body('description').optional({ checkFalsy: true }).isLength({ max: 500 }).withMessage('الوصف طويل جداً'),
  body('amount').notEmpty().withMessage('المبلغ مطلوب').isFloat({ min: 0 }).withMessage('المبلغ غير صحيح'),
  body('date').notEmpty().withMessage('التاريخ مطلوب').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
  body('category').notEmpty().withMessage('التصنيف مطلوب').isIn(Expense.CATEGORIES).withMessage('التصنيف غير صحيح'),
];

const updateValidators = [
  body('name').optional().isLength({ max: 150 }).withMessage('اسم المصروف طويل جداً'),
  body('description').optional({ checkFalsy: true }).isLength({ max: 500 }).withMessage('الوصف طويل جداً'),
  body('amount').optional().isFloat({ min: 0 }).withMessage('المبلغ غير صحيح'),
  body('date').optional().matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
  body('category').optional().isIn(Expense.CATEGORIES).withMessage('التصنيف غير صحيح'),
];

const reportValidators = [
  query('startDate').notEmpty().withMessage('تاريخ البداية مطلوب').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
  query('endDate').notEmpty().withMessage('تاريخ النهاية مطلوب').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
];

// GET /expenses/report — must be before /:id
router.get('/report', reportValidators, validate, getExpenseReport);

router.get('/', getExpenses);
router.get('/:id', getExpenseById);
router.post('/', createValidators, validate, createExpense);
router.put('/:id', updateValidators, validate, updateExpense);
router.delete('/:id', deleteExpense);

module.exports = router;
