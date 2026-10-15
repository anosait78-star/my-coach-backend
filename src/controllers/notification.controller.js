const mongoose = require('mongoose');
const Notification = require('../models/notification.model');
const AlertState = require('../models/alertState.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { computeAcademyAlerts } = require('../utils/academyAlerts');
const { ensurePlayerAlerts } = require('../utils/playerAlerts');
const { todayFor } = require('./attendance.controller');

// أنواع إشعارات تُنشأ في الـ backend لكنها لا تُعرض في مركز إشعارات النظام.
// إشعارات الرسائل (NEW_MESSAGE) محجوزة لـ Push Notifications مستقبلاً؛ داخل
// التطبيق تُعرض عبر شاشة المحادثات وعدّاد unread الخاص بها، لا هنا.
const HIDDEN_FROM_CENTER = ['NEW_MESSAGE'];
const centerFilter = (recipientType, recipientId) => ({
  recipientType,
  recipientId,
  type: { $nin: HIDDEN_FROM_CENTER },
  isDeleted: { $ne: true },
});

// جلب قائمة إشعارات + عدد غير المقروء لمستلم مُحدَّد.
const listFor = async (recipientType, recipientId, res) => {
  const base = centerFilter(recipientType, recipientId);
  const [items, unread] = await Promise.all([
    Notification.find(base).sort({ createdAt: -1 }).limit(100),
    Notification.countDocuments({ ...base, isRead: false }),
  ]);
  return sendSuccess(res, {
    data: { items, unread },
    message: 'تم جلب الإشعارات بنجاح',
  });
};

const markOneRead = async (recipientType, recipientId, id, res, next) => {
  const notif = await Notification.findById(id);
  if (!notif) return next(new AppError('الإشعار غير موجود', 404));
  if (notif.recipientType !== recipientType || notif.recipientId.toString() !== recipientId.toString()) {
    return next(new AppError('ليس لديك صلاحية لهذا الإشعار', 403));
  }
  if (!notif.isRead) {
    notif.isRead = true;
    await notif.save();
  }
  return sendSuccess(res, { data: notif, message: 'تم تعليم الإشعار كمقروء' });
};

const deleteOne = async (recipientType, recipientId, id, res, next) => {
  const notif = await Notification.findById(id);
  if (!notif) return next(new AppError('الإشعار غير موجود', 404));
  if (notif.recipientType !== recipientType || notif.recipientId.toString() !== recipientId.toString()) {
    return next(new AppError('ليس لديك صلاحية لهذا الإشعار', 403));
  }
  notif.isDeleted = true;
  notif.isRead = true;
  await notif.save();
  return sendSuccess(res, { message: 'تم حذف الإشعار' });
};

const markAllRead = async (recipientType, recipientId, res) => {
  // نقتصر على الإشعارات المعروضة في المركز حتى لا نُعلّم إشعارات الرسائل
  // المخفيّة (NEW_MESSAGE) كمقروءة عبر هذا الزر.
  await Notification.updateMany(
    { ...centerFilter(recipientType, recipientId), isRead: false },
    { $set: { isRead: true } }
  );
  return sendSuccess(res, { message: 'تم تعليم كل الإشعارات كمقروءة' });
};

// ─────────────── جهة الأكاديمية (recipientId = academyId) ───────────────
const getAcademyNotifications = async (req, res, next) => {
  const academyId = req.user.academyId;
  if (!academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  return listFor('academy', academyId, res);
};

const markAcademyNotificationRead = async (req, res, next) => {
  if (!req.user.academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  return markOneRead('academy', req.user.academyId, req.params.id, res, next);
};

const deleteAcademyNotification = async (req, res, next) => {
  if (!req.user.academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  return deleteOne('academy', req.user.academyId, req.params.id, res, next);
};

const markAllAcademyRead = async (req, res, next) => {
  if (!req.user.academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  return markAllRead('academy', req.user.academyId, res);
};

// ─────────────── تنبيهات الإدارة المحسوبة (GET /notifications/alerts) ───────────────
// أعياد الميلاد، تذكير الاشتراك (أسبوع/يومان/يوم الانتهاء/منتهٍ)، طلبات الانضمام،
// الغياب المتكرر — تُحسب لحظياً، وحالة القراءة/الإخفاء محفوظة لكل مستخدم.
// السوبر أدمن: كل الفروع (أو ?academyId=). غيره: فرعه.
const getAcademyAlerts = async (req, res, next) => {
  const isSuper = req.user.role === 'super_admin';
  let academyIds = null;
  if (isSuper) {
    const id = req.query.academyId;
    if (id && id !== 'all') {
      if (!mongoose.Types.ObjectId.isValid(String(id))) {
        return next(new AppError('معرّف الأكاديمية غير صحيح', 400));
      }
      academyIds = [new mongoose.Types.ObjectId(String(id))];
    }
  } else {
    if (!req.user.academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
    academyIds = [req.user.academyId];
  }

  const alerts = await computeAcademyAlerts({
    academyIds,
    // المشرف المحدود (admin) لا يملك صلاحية الاشتراكات.
    includeSubscriptions: req.user.role !== 'admin',
    labelBranch: isSuper && !academyIds,
    today: todayFor(req),
  });

  const states = await AlertState.find({
    userId: req.user._id,
    alertId: { $in: alerts.map((a) => a.id) },
  }).select('alertId read dismissed');
  const stateOf = new Map(states.map((s) => [s.alertId, s]));

  const items = alerts
    .filter((a) => !stateOf.get(a.id)?.dismissed)
    .map((a) => ({ ...a, isRead: Boolean(stateOf.get(a.id)?.read) }))
    .sort((a, b) => (a.isRead === b.isRead
      ? b.createdAt.localeCompare(a.createdAt)
      : (a.isRead ? 1 : -1)));

  return sendSuccess(res, {
    data: { items, unread: items.filter((a) => !a.isRead).length },
    message: 'تم جلب التنبيهات بنجاح',
  });
};

// ─── POST /notifications/alerts/state  { ids[], read?, dismissed? } ──────────
// تعليم تنبيهات كمقروءة و/أو إخفاؤها — لهذا المستخدم على كل أجهزته.
const updateAlertState = async (req, res, next) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : [])
    .map(String).filter((s) => s && s.length <= 200))].slice(0, 2000);
  if (!ids.length) return next(new AppError('قائمة التنبيهات مطلوبة', 400));

  const set = {};
  if (req.body.read === true) set.read = true;
  if (req.body.dismissed === true) {
    set.dismissed = true;
    set.read = true;
  }
  if (!Object.keys(set).length) return next(new AppError('لا يوجد تحديث', 400));

  await AlertState.bulkWrite(ids.map((alertId) => ({
    updateOne: {
      filter: { userId: req.user._id, alertId },
      update: { $set: set },
      upsert: true,
    },
  })), { ordered: false });

  return sendSuccess(res, { message: 'تم تحديث التنبيهات' });
};

// ─────────────── جهة اللاعب (recipientId = playerId) ───────────────
const getPlayerNotifications = async (req, res) => {
  // تذكير الاشتراك والغياب المتكرر يُولَّدان عند الفتح (لا مهام مجدولة).
  await ensurePlayerAlerts(req.player, todayFor(req));
  return listFor('player', req.player._id, res);
};

const markPlayerNotificationRead = async (req, res, next) => {
  return markOneRead('player', req.player._id, req.params.id, res, next);
};

const deletePlayerNotification = async (req, res, next) => {
  return deleteOne('player', req.player._id, req.params.id, res, next);
};

const markAllPlayerRead = async (req, res) => {
  return markAllRead('player', req.player._id, res);
};

module.exports = {
  getAcademyAlerts,
  updateAlertState,
  getAcademyNotifications,
  markAcademyNotificationRead,
  markAllAcademyRead,
  deleteAcademyNotification,
  getPlayerNotifications,
  markPlayerNotificationRead,
  markAllPlayerRead,
  deletePlayerNotification,
};
