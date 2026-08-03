const Activity = require('../models/activity.model');
const logger = require('./logger');

// تسجيل نشاط بشكل "fire-and-forget": لا يكسر العملية الأساسية ولا يؤخّرها.
// يُقرأ المستخدم من req.user (id, name, academyId). إن غاب academyId
// (نادراً، مثل super_admin) نستخدم academyId المُمرّر صراحةً.
const logActivity = (req, { actionType, entityType, entityId, entityName, academyId }) => {
  try {
    const user = req && req.user;
    if (!user) return;
    const acadId = academyId || user.academyId;
    if (!acadId) return; // لا نسجّل بلا أكاديمية

    // لا ننتظر النتيجة — أي خطأ يُبتلع حتى لا يؤثر على الاستجابة.
    Activity.create({
      userId: user._id,
      userName: user.name || '',
      academyId: acadId,
      actionType,
      entityType,
      entityId: entityId ? String(entityId) : null,
      entityName: entityName || '',
    }).catch((err) => {
      logger.warn(`[ACTIVITY] failed to log ${actionType}: ${err.message}`);
    });
  } catch (err) {
    logger.warn(`[ACTIVITY] logActivity error: ${err.message}`);
  }
};

module.exports = { logActivity };
