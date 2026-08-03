const express = require('express');
const { body, param } = require('express-validator');
const {
  getAcademyConversations,
  getAcademyMessages,
  academySendMessage,
} = require('../controllers/chat.controller');
const { protect } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

// محادثات جهة الأكاديمية — تتطلب مصادقة مدير.
router.use(protect);

// GET  /api/v1/chat/conversations
router.get('/conversations', getAcademyConversations);

// GET  /api/v1/chat/conversations/:playerId/messages
router.get(
  '/conversations/:playerId/messages',
  [param('playerId').isMongoId().withMessage('معرّف اللاعب غير صحيح')],
  validate,
  getAcademyMessages
);

// POST /api/v1/chat/conversations/:playerId/messages
router.post(
  '/conversations/:playerId/messages',
  [
    param('playerId').isMongoId().withMessage('معرّف اللاعب غير صحيح'),
    body('text').notEmpty().withMessage('نص الرسالة مطلوب')
      .isLength({ max: 1000 }).withMessage('الرسالة لا يمكن أن تتجاوز 1000 حرف'),
  ],
  validate,
  academySendMessage
);

module.exports = router;
