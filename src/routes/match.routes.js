const express = require('express');
const { body, param } = require('express-validator');
const {
  getMatches,
  getMatch,
  createMatch,
  updateMatch,
  deleteMatch,
  addPlayers,
  removePlayer,
  logReminder,
} = require('../controllers/match.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { blockIfNotWritable } = require('../middleware/subscriptionGuard');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);
router.use(blockIfNotWritable);

const manage = restrictTo('super_admin', 'academy_admin', 'admin');

const matchValidators = [
  body('name').isLength({ min: 2, max: 150 }).withMessage('اسم المباراة يجب أن يكون بين 2 و150 حرف'),
  body('location').notEmpty().withMessage('مكان المباراة مطلوب')
    .isLength({ max: 200 }).withMessage('المكان لا يمكن أن يتجاوز 200 حرف'),
  body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
  body('time').matches(/^\d{2}:\d{2}$/).withMessage('صيغة الوقت غير صحيحة'),
  body('notes').optional().isLength({ max: 500 }).withMessage('الملاحظات لا يمكن أن تتجاوز 500 حرف'),
  body('sport').optional().isString(),
];

// GET /matches — قراءة مفتوحة لأي مستخدم موثّق
router.get('/', getMatches);
router.get('/:id', [param('id').isMongoId()], validate, getMatch);

router.post('/', manage, matchValidators, validate, createMatch);

router.put(
  '/:id',
  manage,
  [
    param('id').isMongoId(),
    body('name').optional().isLength({ min: 2, max: 150 }),
    body('location').optional().isLength({ max: 200 }),
    body('date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
    body('time').optional().matches(/^\d{2}:\d{2}$/),
    body('notes').optional().isLength({ max: 500 }),
    body('sport').optional().isString(),
  ],
  validate,
  updateMatch
);

router.delete('/:id', manage, [param('id').isMongoId()], validate, deleteMatch);

router.post(
  '/:id/players',
  manage,
  [param('id').isMongoId(), body('playerIds').isArray({ min: 1 }).withMessage('قائمة اللاعبين مطلوبة')],
  validate,
  addPlayers
);

router.delete(
  '/:id/players/:playerId',
  manage,
  [param('id').isMongoId(), param('playerId').isMongoId()],
  validate,
  removePlayer
);

router.post(
  '/:id/reminders/:playerId',
  manage,
  [param('id').isMongoId(), param('playerId').isMongoId()],
  validate,
  logReminder
);

module.exports = router;
