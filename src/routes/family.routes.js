const express = require('express');
const { body, param } = require('express-validator');
const {
  listFamilies,
  searchCandidates,
  createFamily,
  renameFamily,
  addMembers,
  removeMember,
  deleteFamily,
} = require('../controllers/family.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

// إدارة العائلات للسوبر أدمن فقط.
router.use(protect, restrictTo('super_admin'));

const familyId = param('id').isMongoId().withMessage('معرّف العائلة غير صحيح');
const nameRule = body('name').optional().isString()
  .isLength({ max: 100 }).withMessage('اسم العائلة لا يمكن أن يتجاوز 100 حرف');

router.get('/', listFamilies);
router.get('/candidates', searchCandidates);
router.post(
  '/',
  [nameRule, body('accountIds').isArray({ min: 2 }).withMessage('اختر حسابين على الأقل')],
  validate,
  createFamily
);
router.patch('/:id', [familyId, nameRule], validate, renameFamily);
router.post(
  '/:id/members',
  [familyId, body('accountIds').isArray({ min: 1 }).withMessage('اختر حساباً واحداً على الأقل')],
  validate,
  addMembers
);
router.delete(
  '/:id/members/:accountId',
  [familyId, param('accountId').isMongoId().withMessage('معرّف الحساب غير صحيح')],
  validate,
  removeMember
);
router.delete('/:id', [familyId], validate, deleteFamily);

module.exports = router;
