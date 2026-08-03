const express = require('express');
const { body } = require('express-validator');
const {
  getGroups,
  getGroupsByAcademy,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  reorderGroups,
  movePlayers,
} = require('../controllers/group.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { blockIfNotWritable } = require('../middleware/subscriptionGuard');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);
// حارس اشتراك المنصة: يمنع الكتابة عند انتهاء/تعليق الاشتراك (لا يمسّ GET).
router.use(blockIfNotWritable);

const createValidators = [
  body('name')
    .notEmpty().withMessage('اسم المجموعة مطلوب')
    .isLength({ min: 2, max: 150 }).withMessage('الاسم يجب أن يكون بين 2 و 150 حرف'),
  body('capacity')
    .optional({ checkFalsy: true })
    .isInt({ min: 1 }).withMessage('السعة القصوى غير صحيحة'),
  body('isActive').optional().isBoolean().withMessage('قيمة التفعيل غير صحيحة'),
];

const updateValidators = [
  body('name').optional().isLength({ min: 2, max: 150 }).withMessage('الاسم يجب أن يكون بين 2 و 150 حرف'),
  body('capacity').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('السعة القصوى غير صحيحة'),
  body('isActive').optional().isBoolean().withMessage('قيمة التفعيل غير صحيحة'),
];

// GET /groups
router.get('/', getGroups);

// PATCH /groups/reorder ← يجب أن يسبق /:id لتفادي التعارض
router.patch('/reorder', restrictTo('super_admin', 'academy_admin', 'admin'), reorderGroups);

// GET /groups/academy/:academyId
router.get('/academy/:academyId', getGroupsByAcademy);

// GET /groups/:id
router.get('/:id', getGroupById);

// POST /groups — إدارة المجموعات متاحة لمستوى الأكاديمية (مُقيَّد بأكاديميته في الـ controller).
router.post('/', restrictTo('super_admin', 'academy_admin', 'admin'), createValidators, validate, createGroup);

// PATCH /groups/:id
router.patch('/:id', restrictTo('super_admin', 'academy_admin', 'admin'), updateValidators, validate, updateGroup);

// DELETE /groups/:id
router.delete('/:id', restrictTo('super_admin', 'academy_admin', 'admin'), deleteGroup);

// PATCH /groups/:id/move-players — نقل عدة لاعبين إلى هذه المجموعة
router.patch('/:id/move-players', restrictTo('super_admin', 'academy_admin', 'admin'), movePlayers);

module.exports = router;
