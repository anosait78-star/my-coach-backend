const AcademySubscription = require('../models/academySubscription.model');
const Player = require('../models/player.model');
const logger = require('../utils/logger');

// حارس اشتراك المنصة (SaaS). يُطبَّق إضافةً على مسارات الكتابة القائمة دون
// تغيير منطقها. يعتمد على req.user (يأتي من protect) لتحديد أكاديمية الطالب.
//
// مبدأ أساسي (عدم كسر النظام الحالي): إذا لم يوجد اشتراك للأكاديمية إطلاقاً
// (أكاديمية لم تُهاجَر بعد) نسمح بالمرور (fail-open) مع تحذير في السجل، حتى
// لا تُقفَل أكاديمية قائمة قبل تشغيل الهجرة.

// يحمّل اشتراك أكاديمية الطالب ويضعه في req.academySubscription (إن وُجد).
const loadSubscription = async (req) => {
  // super_admin مالك المنصة — لا يُقيَّد.
  if (!req.user || req.user.role === 'super_admin') return null;
  const academyId = req.user.academyId;
  if (!academyId) return null;
  const sub = await AcademySubscription.findOne({ academyId });
  req.academySubscription = sub;
  return sub;
};

// يمنع أي عملية كتابة عندما يكون الاشتراك expired أو suspended.
// القراءة (GET) لا تُمَس إطلاقاً.
const blockIfNotWritable = async (req, res, next) => {
  try {
    if (req.method === 'GET') return next();
    if (!req.user || req.user.role === 'super_admin') return next();

    const sub = await loadSubscription(req);
    if (!sub) {
      // أكاديمية غير مُهاجَرة أو بلا اشتراك — لا نكسر عملها.
      logger.warn(`[SUB-GUARD] no subscription for academy ${req.user.academyId} — allowing write (fail-open)`);
      return next();
    }

    if (!sub.isWritable()) {
      const status = sub.effectiveStatus();
      return res.status(403).json({
        success: false,
        code: 'SUBSCRIPTION_EXPIRED',
        status,
        message:
          status === 'suspended'
            ? 'تم تعليق اشتراك الأكاديمية. يرجى التواصل مع إدارة Nosait.'
            : 'انتهت الفترة التجريبية / الاشتراك. يرجى التواصل مع إدارة Nosait لتفعيل الاشتراك.',
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

// يمنع تجاوز الحد الأقصى للاعبين (خاصةً أثناء الفترة التجريبية = 7 لاعبين).
// يُوضَع قبل إنشاء اللاعب. يعدّ اللاعبين النشطين الحاليين للأكاديمية.
const enforcePlayerLimit = async (req, res, next) => {
  try {
    if (!req.user || req.user.role === 'super_admin') return next();

    const academyId = req.user.academyId;
    if (!academyId) return next();

    const sub = req.academySubscription || (await AcademySubscription.findOne({ academyId }));
    if (!sub) {
      logger.warn(`[SUB-GUARD] no subscription for academy ${academyId} — skipping player limit`);
      return next();
    }

    const activeCount = await Player.countDocuments({ academyId, isActive: true });
    if (activeCount >= sub.maxPlayers) {
      const isTrial = sub.effectiveStatus() === 'trial';
      return res.status(403).json({
        success: false,
        code: 'PLAYER_LIMIT_REACHED',
        isTrial,
        maxPlayers: sub.maxPlayers,
        message: isTrial
          ? 'لقد وصلت إلى الحد الأقصى للفترة التجريبية (7 لاعبين). تواصل معنا للترقية.'
          : `لقد وصلت إلى الحد الأقصى لعدد اللاعبين (${sub.maxPlayers}). تواصل مع إدارة Nosait.`,
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = { blockIfNotWritable, enforcePlayerLimit, loadSubscription };
