const AcademySubscription = require('../models/academySubscription.model');
const Academy = require('../models/academy.model');
const Player = require('../models/player.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');
const logger = require('../utils/logger');

// عدد الأشهر المسموح بها للباقات (يطابق واجهة اختيار الباقة في التطبيق).
const ALLOWED_DURATION_MONTHS = [1, 3, 6, 12];

// تطبيع مدة الاشتراك بالأشهر القادمة من الطلب (اختيارية وغير كاسرة).
const normalizeDurationMonths = (value) => {
  const n = Number(value);
  return ALLOWED_DURATION_MONTHS.includes(n) ? n : null;
};

// حساب تاريخ النهاية من تاريخ بداية معطى.
// - إذا مُرّرت مدة صريحة بالأشهر (durationMonths) تُستخدم مباشرة (1/3/6/12).
// - وإلا يُرجَع للسلوك القديم حسب الباقة (شهر/سنة) للحفاظ على التوافق.
const computeEndDate = (startDate, plan, durationMonths) => {
  const end = new Date(startDate);
  const months = normalizeDurationMonths(durationMonths);
  if (months != null) {
    end.setMonth(end.getMonth() + months);
    return end;
  }
  if (plan === 'month') end.setMonth(end.getMonth() + 1);
  else if (plan === 'year') end.setFullYear(end.getFullYear() + 1);
  else end.setDate(end.getDate() + 7); // احتياطي (trial)
  return end;
};

// يبني تمثيل صف موحّد للأكاديمية + اشتراكها.
const buildRow = (academy, sub, playerCount) => {
  const s = sub || null;
  return {
    academyId: academy._id.toString(),
    academyName: academy.name,
    isActive: academy.isActive,
    playerCount,
    subscription: s
      ? {
          _id: s._id.toString(),
          status: s.effectiveStatus(),
          rawStatus: s.status,
          plan: s.plan,
          maxPlayers: s.maxPlayers,
          durationMonths: s.durationMonths ?? null,
          startDate: s.startDate,
          endDate: s.endDate,
          daysRemaining: s.daysRemaining,
          playerPortalEnabled: s.playerPortalEnabled === true,
        }
      : null,
  };
};

// GET /api/v1/platform/subscriptions — كل الأكاديميات وحالات اشتراكاتها.
const listAcademiesSubscriptions = async (req, res, next) => {
  const [academies, subs, counts] = await Promise.all([
    Academy.find({}).sort({ created_at: -1 }),
    AcademySubscription.find({}),
    Player.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$academyId', count: { $sum: 1 } } },
    ]),
  ]);

  const subByAcademy = new Map(subs.map((s) => [s.academyId.toString(), s]));
  const countByAcademy = new Map(counts.map((c) => [c._id.toString(), c.count]));

  const rows = academies.map((a) =>
    buildRow(a, subByAcademy.get(a._id.toString()), countByAcademy.get(a._id.toString()) || 0)
  );

  return sendSuccess(res, { data: rows, message: 'تم جلب الاشتراكات بنجاح' });
};

// يضمن وجود وثيقة اشتراك للأكاديمية (ينشئ واحدة إن غابت — احتياط للأكاديميات القديمة).
const ensureSubscription = async (academyId) => {
  let sub = await AcademySubscription.findOne({ academyId });
  if (!sub) {
    const now = new Date();
    sub = await AcademySubscription.create({
      academyId,
      status: 'expired',
      plan: 'trial',
      maxPlayers: 0,
      startDate: now,
      endDate: now,
      history: [],
    });
  }
  return sub;
};

// POST /api/v1/platform/subscriptions/:academyId/activate
// body: { plan: 'month'|'year', maxPlayers }
const activateSubscription = async (req, res, next) => {
  const { academyId } = req.params;
  const { plan, maxPlayers, durationMonths, playerPortalEnabled } = req.body;

  const academy = await Academy.findById(academyId).select('name');
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));

  const sub = await ensureSubscription(academyId);

  const now = new Date();
  const months = normalizeDurationMonths(durationMonths);
  const endDate = computeEndDate(now, plan, months);

  sub.status = 'active';
  sub.plan = plan;
  sub.maxPlayers = maxPlayers;
  if (months != null) sub.durationMonths = months;
  sub.startDate = now;
  sub.endDate = endDate;
  // خيار "Enable Player Portal" داخل نافذة التفعيل — اختياري وغير كاسر:
  // إن لم يُرسَل تبقى القيمة الحالية كما هي.
  if (playerPortalEnabled !== undefined) {
    sub.playerPortalEnabled = playerPortalEnabled === true || playerPortalEnabled === 'true';
  }
  sub.history.push({
    action: 'ACTIVATED',
    plan,
    maxPlayers,
    startDate: now,
    endDate,
    changedBy: req.user._id,
    changedByName: req.user.name || '',
    note: 'تفعيل اشتراك من الإدارة',
    changedAt: now,
  });
  await sub.save();

  logger.info(`Subscription activated for academy ${academyId}: ${plan}, max ${maxPlayers}`);
  logActivity(req, {
    actionType: 'ACTIVATE_SUBSCRIPTION',
    entityType: 'PLATFORM_SUBSCRIPTION',
    entityId: sub._id,
    entityName: academy.name,
    academyId,
  });

  return sendSuccess(res, {
    data: buildRow(academy, sub, undefined).subscription,
    message: 'تم تفعيل الاشتراك بنجاح',
  });
};

// PATCH /api/v1/platform/subscriptions/:academyId
// body: { plan?, maxPlayers?, status? } — تعديل بدون إنشاء اشتراك جديد + تسجيل في History.
const updateSubscription = async (req, res, next) => {
  const { academyId } = req.params;
  const { plan, maxPlayers, durationMonths, status, playerPortalEnabled } = req.body;

  const academy = await Academy.findById(academyId).select('name');
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));

  const sub = await ensureSubscription(academyId);
  const now = new Date();
  let action = 'UPDATED';
  const months = normalizeDurationMonths(durationMonths);

  if (plan !== undefined) sub.plan = plan;

  // إعادة حساب تاريخ النهاية عند تمرير مدة صريحة (1/3/6/12) أو تغيير الباقة.
  if (months != null) {
    sub.durationMonths = months;
    sub.endDate = computeEndDate(sub.startDate || now, sub.plan, months);
    if (sub.effectiveStatus() !== 'active' && new Date() <= sub.endDate) sub.status = 'active';
  } else if (plan === 'month' || plan === 'year') {
    sub.endDate = computeEndDate(sub.startDate || now, plan);
    if (sub.effectiveStatus() !== 'active' && new Date() <= sub.endDate) sub.status = 'active';
  }

  if (maxPlayers !== undefined) sub.maxPlayers = maxPlayers;

  if (status !== undefined && status !== sub.status) {
    sub.status = status;
    if (status === 'suspended') action = 'SUSPENDED';
    else if (status === 'active') action = 'REACTIVATED';
  }

  // تعديل ميزة بوابة اللاعب بشكل مستقل عن حالة الاشتراك.
  if (playerPortalEnabled !== undefined) {
    sub.playerPortalEnabled = playerPortalEnabled === true || playerPortalEnabled === 'true';
  }

  sub.history.push({
    action,
    plan: sub.plan,
    maxPlayers: sub.maxPlayers,
    startDate: sub.startDate,
    endDate: sub.endDate,
    changedBy: req.user._id,
    changedByName: req.user.name || '',
    note: 'تعديل اشتراك من الإدارة',
    changedAt: now,
  });
  await sub.save();

  logger.info(`Subscription updated for academy ${academyId}`);
  logActivity(req, {
    actionType: 'UPDATE_SUBSCRIPTION',
    entityType: 'PLATFORM_SUBSCRIPTION',
    entityId: sub._id,
    entityName: academy.name,
    academyId,
  });

  return sendSuccess(res, {
    data: buildRow(academy, sub, undefined).subscription,
    message: 'تم تعديل الاشتراك بنجاح',
  });
};

// PATCH /api/v1/platform/subscriptions/:academyId/player-portal
// body: { enabled: boolean } — تفعيل/تعطيل بوابة اللاعب في أي وقت
// دون المساس بحالة الاشتراك أو باقته أو تواريخه.
const setPlayerPortal = async (req, res, next) => {
  const { academyId } = req.params;
  const enabled = req.body.enabled === true || req.body.enabled === 'true';

  const academy = await Academy.findById(academyId).select('name');
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));

  const sub = await ensureSubscription(academyId);
  const now = new Date();

  sub.playerPortalEnabled = enabled;
  sub.history.push({
    action: enabled ? 'PORTAL_ENABLED' : 'PORTAL_DISABLED',
    plan: sub.plan,
    maxPlayers: sub.maxPlayers,
    startDate: sub.startDate,
    endDate: sub.endDate,
    changedBy: req.user._id,
    changedByName: req.user.name || '',
    note: enabled ? 'تفعيل بوابة اللاعب من الإدارة' : 'تعطيل بوابة اللاعب من الإدارة',
    changedAt: now,
  });
  await sub.save();

  logger.info(`Player portal ${enabled ? 'enabled' : 'disabled'} for academy ${academyId}`);
  logActivity(req, {
    actionType: 'UPDATE_SUBSCRIPTION',
    entityType: 'PLATFORM_SUBSCRIPTION',
    entityId: sub._id,
    entityName: academy.name,
    academyId,
  });

  return sendSuccess(res, {
    data: buildRow(academy, sub, undefined).subscription,
    message: enabled ? 'تم تفعيل بوابة اللاعب' : 'تم تعطيل بوابة اللاعب',
  });
};

// GET /api/v1/platform/subscriptions/:academyId/history
const getSubscriptionHistory = async (req, res, next) => {
  const { academyId } = req.params;
  const sub = await AcademySubscription.findOne({ academyId });
  if (!sub) return next(new AppError('لا يوجد اشتراك لهذه الأكاديمية', 404));
  return sendSuccess(res, { data: sub.history || [], message: 'تم جلب سجل الاشتراك بنجاح' });
};

module.exports = {
  listAcademiesSubscriptions,
  activateSubscription,
  updateSubscription,
  setPlayerPortal,
  getSubscriptionHistory,
};
