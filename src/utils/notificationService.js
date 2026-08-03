const Notification = require('../models/notification.model');
const logger = require('./logger');

// إنشاء إشعار بشكل "fire-and-forget": لا يكسر العملية الأساسية ولا يؤخّرها.
// recipientType: 'player' → recipientId = playerId
// recipientType: 'academy' → recipientId = academyId (يُعرض لكل مدراء الأكاديمية)
const notify = ({ recipientType, recipientId, academyId, type, title, body = '', meta = {} }) => {
  try {
    if (!recipientType || !recipientId || !academyId || !type || !title) return;
    Notification.create({
      recipientType,
      recipientId,
      academyId,
      type,
      title,
      body,
      meta,
    }).catch((err) => {
      logger.warn(`[NOTIFY] failed to create ${type}: ${err.message}`);
    });
  } catch (err) {
    logger.warn(`[NOTIFY] notify error: ${err.message}`);
  }
};

module.exports = { notify };
