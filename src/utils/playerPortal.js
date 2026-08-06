// بوابة اللاعب مفعّلة دائماً لكل الأكاديميات — لا يوجد نظام اشتراك منصة يقيّدها.
const checkPlayerPortal = async () => ({ active: true, code: null });

const portalDisabledMessage = () =>
  'بوابة اللاعب غير مفعّلة لهذه الأكاديمية. يرجى التواصل مع أكاديميتك.';

module.exports = { checkPlayerPortal, portalDisabledMessage };
