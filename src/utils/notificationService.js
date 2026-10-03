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

/**
 * إشعار واحد لكل لاعب نشط ومعتمد في الفروع [academyIds] (مصفوفة فارغة/null =
 * كل الفروع). insertMany دفعة واحدة. fire-and-forget مثل notify.
 * [dedupeMinutes]: لا يُرسَل إن سبقه إشعار من نفس النوع لنفس الفرع خلال هذه
 * المدة — رفع عدة صور للألبوم متتالية = إشعار واحد.
 */
const notifyAcademyPlayers = ({ academyIds, type, title, body = '', meta = {}, dedupeMinutes = 0 }) => {
  (async () => {
    // تحميل متأخر لتفادي الاعتماد الدائري بين الموديلات والخدمات.
    const Player = require('../models/player.model');
    const scope = Array.isArray(academyIds) && academyIds.length
      ? { academyId: { $in: academyIds } }
      : {};
    if (dedupeMinutes > 0) {
      const since = new Date(Date.now() - dedupeMinutes * 60 * 1000);
      const recent = await Notification.distinct('academyId', {
        recipientType: 'player', type, createdAt: { $gte: since }, ...scope,
      });
      if (recent.length && Array.isArray(academyIds) && academyIds.length) {
        const done = new Set(recent.map(String));
        academyIds = academyIds.filter((id) => !done.has(String(id)));
        if (!academyIds.length) return;
        scope.academyId = { $in: academyIds };
      }
    }
    const players = await Player.find({ ...scope, isActive: true, ...Player.APPROVED_ONLY })
      .select('_id academyId');
    if (!players.length) return;
    await Notification.insertMany(
      players.map((p) => ({
        recipientType: 'player',
        recipientId: p._id,
        academyId: p.academyId,
        type,
        title,
        body,
        meta,
      })),
      { ordered: false }
    );
  })().catch((err) => logger.warn(`[NOTIFY] bulk ${type} failed: ${err.message}`));
};

module.exports = { notify, notifyAcademyPlayers };
