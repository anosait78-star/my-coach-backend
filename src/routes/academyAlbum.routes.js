const express = require('express');
const { body, param } = require('express-validator');
const {
  getAlbum,
  createAlbumImage,
  updateAlbumImage,
  deleteAlbumImage,
  reorderAlbum,
} = require('../controllers/academyAlbum.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { blockIfNotWritable } = require('../middleware/subscriptionGuard');
const { uploadAlbumImage } = require('../config/cloudinary');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);
// حارس اشتراك المنصة: يمنع الكتابة عند انتهاء/تعليق الاشتراك (لا يمسّ GET).
router.use(blockIfNotWritable);

const manage = restrictTo('super_admin', 'academy_admin', 'admin');

// GET /academy-album — قائمة مرقّمة (Pagination)
router.get('/', getAlbum);

// PATCH /academy-album/reorder ← قبل /:id لتفادي التعارض
router.patch('/reorder', manage, reorderAlbum);

// POST /academy-album — رفع صورة (نفس multer/Cloudinary، حد 2MB مطبَّق هناك)
router.post(
  '/',
  manage,
  uploadAlbumImage.single('image'),
  [
    body('title').notEmpty().withMessage('العنوان مطلوب')
      .isLength({ max: 150 }).withMessage('العنوان لا يمكن أن يتجاوز 150 حرف'),
    body('description').optional().isLength({ max: 1000 })
      .withMessage('الوصف لا يمكن أن يتجاوز 1000 حرف'),
  ],
  validate,
  createAlbumImage
);

// PATCH /academy-album/:id — تعديل العنوان/الوصف
router.patch(
  '/:id',
  manage,
  [
    param('id').isMongoId().withMessage('معرّف الصورة غير صحيح'),
    body('title').optional().isLength({ min: 1, max: 150 })
      .withMessage('العنوان يجب أن يكون بين 1 و 150 حرف'),
    body('description').optional().isLength({ max: 1000 })
      .withMessage('الوصف لا يمكن أن يتجاوز 1000 حرف'),
  ],
  validate,
  updateAlbumImage
);

// DELETE /academy-album/:id
router.delete(
  '/:id',
  manage,
  [param('id').isMongoId().withMessage('معرّف الصورة غير صحيح')],
  validate,
  deleteAlbumImage
);

module.exports = router;
