const mongoose = require('mongoose');
const AppError = require('./AppError');

// نطاق الأكاديمية للموديولات الإدارية (الموظفين/الرواتب/المصروفات/حضور الموظفين).
//
// super_admin بلا academyId في التوكن، فيمرّرها صراحةً — من الـ query للقراءة
// ومن الـ body للكتابة (نقبل الاثنين لتبسيط الفرونت). أي دور آخر
// (academy_admin / admin) مُقيَّد حتمياً بأكاديميته ولا يستطيع تجاوزها.
//
// نفس نمط resolveAcademyFilter في group/store/match/teamKit، مع تحقّق من صيغة
// المعرّف حتى لا يتحوّل إدخال خاطئ إلى CastError بحالة 500.
const resolveAcademyScope = (req) => {
  if (req.user.role === 'super_admin') {
    const raw = req.query.academyId || req.body?.academyId;
    if (!raw) {
      throw new AppError('معرّف الأكاديمية مطلوب', 400);
    }
    const academyId = String(raw);
    if (!mongoose.Types.ObjectId.isValid(academyId)) {
      throw new AppError('معرّف الأكاديمية غير صحيح', 400);
    }
    return academyId;
  }
  return req.user.academyId;
};

// نفس النطاق لكن مصبوباً كـ ObjectId — مطلوب داخل $match في aggregate،
// لأن mongoose لا يصبّ الأنواع تلقائياً في خطوات الـ aggregation.
const resolveAcademyScopeAsObjectId = (req) => {
  const scope = resolveAcademyScope(req);
  return scope instanceof mongoose.Types.ObjectId
    ? scope
    : new mongoose.Types.ObjectId(String(scope));
};

// حارس وصول لوثيقة تخصّ أكاديمية أخرى.
// super_admin يتجاوز القيد لأن نطاقه مُحدَّد أصلاً بالـ academyId المُمرّر.
const assertAcademyAccess = (req, doc, message) => {
  if (
    req.user.role !== 'super_admin' &&
    doc.academyId.toString() !== req.user.academyId?.toString()
  ) {
    throw new AppError(message, 403);
  }
};

module.exports = { resolveAcademyScope, resolveAcademyScopeAsObjectId, assertAcademyAccess };
