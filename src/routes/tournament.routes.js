const express = require('express');
const { body, param } = require('express-validator');
const c = require('../controllers/tournament.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

// كل الحسابات الإدارية تدير البطولات (بدون أنواع حسابات جديدة)؛ حدود الفروع تُفرض في الكنترولر.
const manage = restrictTo('super_admin', 'academy_admin', 'admin');
const id = [param('id').isMongoId().withMessage('معرّف البطولة غير صحيح')];

const tournamentValidators = (optional) => {
  const f = (field) => (optional ? body(field).optional() : body(field));
  return [
    f('name').isString().trim().isLength({ min: 2, max: 150 }).withMessage('اسم البطولة يجب أن يكون بين 2 و150 حرف'),
    f('participantType').isIn(['individual', 'team']).withMessage('نوع المشاركة غير صحيح'),
    f('format').isIn(['league', 'knockout', 'groups_knockout']).withMessage('نظام البطولة غير صحيح'),
    body('drawMode').optional().isIn(['random', 'directed']).withMessage('طريقة القرعة غير صحيحة'),
    body('academyIds').optional().isArray({ min: 1 }).withMessage('يجب اختيار فرع واحد على الأقل'),
    body('startDate').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
    body('endDate').optional({ nullable: true }).matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('صيغة التاريخ غير صحيحة'),
    body('notes').optional().isString().isLength({ max: 1000 }),
    body('visibleToPlayers').optional().isBoolean(),
    body('scoring.mode').optional().isIn(['goals', 'sets']).withMessage('طريقة تسجيل النتيجة غير صحيحة'),
    body('scoring.bestOf').optional().isInt({ min: 1, max: 9 }).withMessage('عدد الأشواط بين 1 و9'),
    body('scoring.pointsPerSet').optional().isInt({ min: 1, max: 100 }).withMessage('نقاط الشوط بين 1 و100'),
    body('scoring.winByTwo').optional().isBoolean(),
    body('scoring.maxPointsPerSet').optional({ nullable: true }).isInt({ min: 1, max: 200 }),
    body(['league.winPoints', 'league.drawPoints', 'league.lossPoints']).optional().isInt({ min: 0, max: 10 }),
    body(['league.doubleRound', 'league.allowDraws']).optional().isBoolean(),
    body('groups.count').optional().isInt({ min: 2, max: 16 }).withMessage('عدد المجموعات بين 2 و16'),
    body('groups.qualifiersPerGroup').optional().isInt({ min: 1, max: 8 }).withMessage('عدد المتأهلين بين 1 و8'),
    body('knockout.penaltiesEnabled').optional().isBoolean(),
    body('knockout.penaltiesCount').optional().isInt({ min: 1, max: 20 }).withMessage('عدد ضربات الترجيح بين 1 و20'),
  ];
};

router.get('/', c.listTournaments);
router.post('/', manage, tournamentValidators(false), validate, c.createTournament);
router.get('/:id', id, validate, c.getTournament);
router.put('/:id', manage, id, tournamentValidators(true), validate, c.updateTournament);
router.delete('/:id', manage, id, validate, c.deleteTournament);

// المشاركون
router.post(
  '/:id/participants',
  manage,
  [...id, body('playerIds').isArray({ min: 1 }).withMessage('يجب اختيار لاعب واحد على الأقل')],
  validate,
  c.addParticipant
);
router.put('/:id/participants/order', manage, [...id, body('order').isArray()], validate, c.orderParticipants);
router.put('/:id/participants/:participantId', manage, [...id, param('participantId').isMongoId()], validate, c.updateParticipant);
router.delete('/:id/participants/:participantId', manage, [...id, param('participantId').isMongoId()], validate, c.removeParticipant);

// الجدول والنتائج
router.post('/:id/generate', manage, id, validate, c.generateFixtures);
router.delete('/:id/fixtures', manage, id, validate, c.resetFixtures);
router.put('/:id/fixtures/:fixtureId', manage, [...id, param('fixtureId').isMongoId()], validate, c.updateFixture);
router.post('/:id/fixtures/:fixtureId/result', manage, [...id, param('fixtureId').isMongoId()], validate, c.recordResult);
router.delete('/:id/fixtures/:fixtureId/result', manage, [...id, param('fixtureId').isMongoId()], validate, c.clearResult);

module.exports = router;
