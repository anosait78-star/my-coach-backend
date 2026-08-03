const AcademySubscription = require('../models/academySubscription.model');

// فحص جاهزية بوابة اللاعب لأكاديمية معيّنة.
// القاعدة: الميزة يجب أن تكون مفعّلة (playerPortalEnabled) والاشتراك حيّاً
// (trial/active). انتهاء الاشتراك — حتى التجريبي — يوقف البوابة تلقائياً.
// لا وجود لاشتراك = بوابة معطّلة (الأكاديميات القديمة قبل الهجرة).
const checkPlayerPortal = async (academyId) => {
  if (!academyId) {
    return { active: false, code: 'PLAYER_PORTAL_DISABLED' };
  }
  const sub = await AcademySubscription.findOne({ academyId });
  if (!sub || !sub.playerPortalEnabled) {
    return { active: false, code: 'PLAYER_PORTAL_DISABLED' };
  }
  if (!sub.isWritable()) {
    return { active: false, code: 'SUBSCRIPTION_EXPIRED' };
  }
  return { active: true, code: null };
};

const portalDisabledMessage = (code) =>
  code === 'SUBSCRIPTION_EXPIRED'
    ? 'انتهى اشتراك الأكاديمية — بوابة اللاعب متوقفة مؤقتاً. يرجى التواصل مع أكاديميتك.'
    : 'بوابة اللاعب غير مفعّلة لهذه الأكاديمية. يرجى التواصل مع أكاديميتك.';

module.exports = { checkPlayerPortal, portalDisabledMessage };
