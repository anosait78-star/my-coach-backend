const express = require('express');
const { body, param, query } = require('express-validator');
const {
  getPlayerVideos,
  createPlayerVideo,
  updatePlayerVideo,
  deletePlayerVideo,
  likeAsAdmin,
  unlikeAsAdmin,
  listCommentsAsAdmin,
  addCommentAsAdmin,
  removeCommentAsAdmin,
} = require('../controllers/playerVideo.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

// إضافة/تعديل/حذف الفيديوهات لإدارة الأكاديمية. القراءة والإعجاب والتعليق
// متاحة لكل من يصل لبروفايل اللاعب (نفس أدوار الإدارة).
const manage = restrictTo('super_admin', 'academy_admin', 'admin');

const idParam = [param('id').isMongoId().withMessage('معرّف الفيديو غير صحيح')];

const contentValidators = [
  body('title').optional().isLength({ min: 1, max: 150 })
    .withMessage('العنوان يجب أن يكون بين 1 و 150 حرف'),
  body('description').optional().isLength({ max: 1000 })
    .withMessage('الوصف لا يمكن أن يتجاوز 1000 حرف'),
  body('url').optional().isLength({ max: 500 })
    .withMessage('الرابط طويل جداً'),
];

// ─── GET /player-videos?playerId=... ────────────────────────────────────────
router.get(
  '/',
  [query('playerId').isMongoId().withMessage('معرّف اللاعب غير صحيح')],
  validate,
  getPlayerVideos
);

// ─── POST /player-videos ────────────────────────────────────────────────────
router.post(
  '/',
  manage,
  [
    body('playerId').isMongoId().withMessage('معرّف اللاعب غير صحيح'),
    body('title').notEmpty().withMessage('العنوان مطلوب')
      .isLength({ max: 150 }).withMessage('العنوان لا يمكن أن يتجاوز 150 حرف'),
    body('url').notEmpty().withMessage('رابط الفيديو مطلوب'),
    ...contentValidators,
  ],
  validate,
  createPlayerVideo
);

router.patch('/:id', manage, [...idParam, ...contentValidators], validate, updatePlayerVideo);
router.delete('/:id', manage, idParam, validate, deletePlayerVideo);

// ─── إعجاب ──────────────────────────────────────────────────────────────────
router.post('/:id/like', idParam, validate, likeAsAdmin);
router.delete('/:id/like', idParam, validate, unlikeAsAdmin);

// ─── تعليقات ────────────────────────────────────────────────────────────────
router.get('/:id/comments', idParam, validate, listCommentsAsAdmin);
router.post(
  '/:id/comments',
  [
    ...idParam,
    body('text').notEmpty().withMessage('نص التعليق مطلوب')
      .isLength({ max: 1000 }).withMessage('التعليق لا يمكن أن يتجاوز 1000 حرف'),
  ],
  validate,
  addCommentAsAdmin
);
router.delete(
  '/:id/comments/:commentId',
  [
    ...idParam,
    param('commentId').isMongoId().withMessage('معرّف التعليق غير صحيح'),
  ],
  validate,
  removeCommentAsAdmin
);

module.exports = router;
