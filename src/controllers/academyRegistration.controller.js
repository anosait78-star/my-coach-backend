const Academy = require('../models/academy.model');
const User = require('../models/user.model');
const AcademySubscription = require('../models/academySubscription.model');
const AppError = require('../utils/AppError');
const { generateToken, generateRefreshToken } = require('../utils/jwt');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');

const TRIAL_DAYS = 7;
const TRIAL_MAX_PLAYERS = 7;

// POST /api/v1/register-academy  (عام) — تسجيل ذاتي لأكاديمية جديدة.
// ينشئ تلقائياً: Academy + User(academy_admin) + AcademySubscription(trial).
// يسجّل الدخول مباشرة (يعيد token) لتجربة سلسة.
const registerAcademy = async (req, res, next) => {
  const { academyName, adminName, phone, email, city, sport, password, currency } =
    req.body;

  // منع تكرار البريد قبل أي إنشاء.
  const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (existing) {
    if (req.file && req.file.filename) await deleteImage(req.file.filename).catch(() => {});
    return next(new AppError('البريد الإلكتروني مستخدم بالفعل', 409));
  }

  let academy;
  let user;
  try {
    // 1) الأكاديمية
    academy = await Academy.create({
      name: academyName,
      phone,
      address: city, // المدينة تُخزَّن كعنوان (النموذج الحالي يتطلب address)
      // العملة مشتقّة من الدولة المختارة في الفرونت؛ الافتراضي EGP لو غابت.
      currency: currency || 'EGP',
      sports: [sport],
      logo_url: req.file ? req.file.path : null,
      logo_public_id: req.file ? req.file.filename : null,
    });

    // 2) مدير الأكاديمية
    user = await User.create({
      name: adminName,
      email,
      password,
      role: 'academy_admin',
      academyId: academy._id,
    });

    // 3) اشتراك تجريبي (7 أيام / 7 لاعبين)
    const now = new Date();
    const endDate = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await AcademySubscription.create({
      academyId: academy._id,
      status: 'trial',
      plan: 'trial',
      maxPlayers: TRIAL_MAX_PLAYERS,
      startDate: now,
      endDate,
      // الأكاديمية الجديدة تحصل على بوابة اللاعب مفعّلة تلقائياً أثناء التجربة.
      playerPortalEnabled: true,
      history: [
        {
          action: 'CREATED_TRIAL',
          plan: 'trial',
          maxPlayers: TRIAL_MAX_PLAYERS,
          startDate: now,
          endDate,
          changedByName: adminName,
          note: 'إنشاء أكاديمية جديدة عبر التسجيل الذاتي',
          changedAt: now,
        },
      ],
    });

    logger.info(`Academy registered: ${academy.name} (${user.email}) — trial ${TRIAL_DAYS}d`);
  } catch (err) {
    // تنظيف عند الفشل حتى لا تبقى بيانات ناقصة.
    if (user) await User.deleteOne({ _id: user._id }).catch(() => {});
    if (academy) await Academy.deleteOne({ _id: academy._id }).catch(() => {});
    if (req.file && req.file.filename) await deleteImage(req.file.filename).catch(() => {});
    return next(err);
  }

  // تسجيل دخول تلقائي.
  const token = generateToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  return res.status(201).json({
    success: true,
    message: 'تم إنشاء الأكاديمية بنجاح',
    token,
    refreshToken,
    data: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      academy_id: academy._id.toString(),
      academy_name: academy.name,
      created_at: user.created_at,
    },
  });
};

module.exports = { registerAcademy };
