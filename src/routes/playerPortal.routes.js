const express = require('express');
const { body, param } = require('express-validator');
const { getPlayerDashboard } = require('../controllers/playerDashboard.controller');
const { getPlayerConversation, playerSendMessage } = require('../controllers/chat.controller');
const {
  getPlayerNotifications,
  markPlayerNotificationRead,
  markAllPlayerRead,
} = require('../controllers/notification.controller');
const { updateMyPhoto, deleteMyPhoto } = require('../controllers/playerProfile.controller');
const { getPlayerAlbum } = require('../controllers/academyAlbum.controller');
const { getPlayerStore, createPlayerOrder } = require('../controllers/store.controller');
const { getPlayerKit, createPlayerBooking } = require('../controllers/teamKit.controller');
const { protectPlayer } = require('../middleware/protectPlayer');
const { uploadPlayerImage } = require('../config/cloudinary');
const { KIT_SIZES } = require('../utils/kitSizes');
const validate = require('../middleware/validate');

const router = express.Router();

// كل مسارات بوابة اللاعب تتطلب توكن لاعب.
router.use(protectPlayer);

// GET /api/v1/player/dashboard
router.get('/dashboard', getPlayerDashboard);

// ── صورة اللاعب الشخصية ──
// يعيد استخدام نفس multer/Cloudinary الخاص بصور اللاعبين (حد 2MB مطبَّق هناك).
router.put('/photo', uploadPlayerImage.single('image'), updateMyPhoto);
router.delete('/photo', deleteMyPhoto);

// ── ألبوم الأكاديمية (قراءة فقط — أكاديمية اللاعب حصراً) ──
router.get('/album', getPlayerAlbum);

// ── متجر الأكاديمية (قراءة + إنشاء طلب شراء — أكاديمية اللاعب حصراً) ──
router.get('/store', getPlayerStore);
router.post(
  '/store/orders',
  [body('productId').isMongoId().withMessage('معرّف المنتج غير صحيح')],
  validate,
  createPlayerOrder
);

// ── طقم الفريق (قراءة + إنشاء حجز — أكاديمية اللاعب حصراً) ──
router.get('/team-kit', getPlayerKit);
router.post(
  '/team-kit/bookings',
  [
    body('shirtName').notEmpty().withMessage('الاسم على التيشرت مطلوب')
      .isLength({ max: 30 }).withMessage('الاسم على التيشرت لا يمكن أن يتجاوز 30 حرف'),
    body('shirtNumber').isInt({ min: 0, max: 999 }).withMessage('الرقم على التيشرت غير صحيح'),
    body('size').isIn(KIT_SIZES).withMessage('المقاس غير صحيح'),
  ],
  validate,
  createPlayerBooking
);

// ── محادثة اللاعب مع أكاديميته (نص فقط) ──
router.get('/chat', getPlayerConversation);
router.post(
  '/chat',
  [
    body('text').notEmpty().withMessage('نص الرسالة مطلوب')
      .isLength({ max: 1000 }).withMessage('الرسالة لا يمكن أن تتجاوز 1000 حرف'),
  ],
  validate,
  playerSendMessage
);

// ── إشعارات اللاعب ──
router.get('/notifications', getPlayerNotifications);
router.patch('/notifications/read-all', markAllPlayerRead);
router.patch(
  '/notifications/:id/read',
  [param('id').isMongoId().withMessage('معرّف الإشعار غير صحيح')],
  validate,
  markPlayerNotificationRead
);

module.exports = router;
