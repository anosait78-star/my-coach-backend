const express = require('express');
const { param } = require('express-validator');
const {
  getAcademyNotifications,
  markAcademyNotificationRead,
  markAllAcademyRead,
  deleteAcademyNotification,
  getAcademyAlerts,
  updateAlertState,
} = require('../controllers/notification.controller');
const { protect } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

// إشعارات جهة الأكاديمية — تتطلب مصادقة مدير.
router.use(protect);

// GET   /api/v1/notifications
router.get('/', getAcademyNotifications);

// GET  /api/v1/notifications/alerts — تنبيهات الإدارة المحسوبة (كل الفروع للسوبر أدمن)
router.get('/alerts', getAcademyAlerts);

// POST /api/v1/notifications/alerts/state — { ids[], read?, dismissed? }
router.post('/alerts/state', updateAlertState);

// PATCH /api/v1/notifications/read-all
router.patch('/read-all', markAllAcademyRead);

// PATCH /api/v1/notifications/:id/read
router.patch(
  '/:id/read',
  [param('id').isMongoId().withMessage('معرّف الإشعار غير صحيح')],
  validate,
  markAcademyNotificationRead
);

// DELETE /api/v1/notifications/:id
router.delete(
  '/:id',
  [param('id').isMongoId().withMessage('معرّف الإشعار غير صحيح')],
  validate,
  deleteAcademyNotification
);

module.exports = router;
