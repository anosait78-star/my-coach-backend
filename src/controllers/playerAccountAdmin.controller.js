const Player = require('../models/player.model');
const PlayerAccount = require('../models/playerAccount.model');
const AcademySubscription = require('../models/academySubscription.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { generateStrongPassword } = require('../utils/generatePassword');
const { logActivity } = require('../utils/activityLogger');
const logger = require('../utils/logger');

// إدارة حسابات دخول اللاعبين من داخل لوحة الأكاديمية (وليس بوابة اللاعب).
// كل الدوال إضافية بالكامل — لا تمسّ أي API قائمة.
// كلمات المرور لا تُحفظ نصاً أبداً: موديل PlayerAccount يشفّرها bcrypt
// تلقائياً في pre('save')، ونعيد كلمة المرور النصية مرة واحدة فقط للعرض.

// يجلب اللاعب ويتحقق من صلاحية المستخدم عليه (نفس منطق updatePlayer الحالي).
const loadAuthorizedPlayer = async (req) => {
  const player = await Player.findById(req.params.id);
  if (!player) return { error: new AppError('اللاعب غير موجود', 404) };
  if (
    req.user.role !== 'super_admin' &&
    player.academyId.toString() !== req.user.academyId?.toString()
  ) {
    return { error: new AppError('ليس لديك صلاحية على هذا اللاعب', 403) };
  }
  return { player };
};

// هل ميزة بوابة اللاعب مفعّلة لأكاديمية هذا اللاعب؟
const isPortalEnabled = async (academyId) => {
  const sub = await AcademySubscription.findOne({ academyId });
  return !!(sub && sub.playerPortalEnabled === true);
};

// ─── GET /players/:id/account ────────────────────────────────────────────────
// حالة حساب اللاعب (بدون أي كلمة مرور) + حالة تفعيل الميزة للأكاديمية.
const getPlayerAccount = async (req, res, next) => {
  const { player, error } = await loadAuthorizedPlayer(req);
  if (error) return next(error);

  const [account, portalEnabled] = await Promise.all([
    PlayerAccount.findOne({ playerId: player._id }),
    isPortalEnabled(player.academyId),
  ]);

  return sendSuccess(res, {
    data: {
      portalEnabled,
      hasAccount: !!account,
      account: account
        ? { _id: account._id.toString(), username: account.username, isActive: account.isActive }
        : null,
    },
    message: 'تم جلب حالة حساب اللاعب',
  });
};

// ─── POST /players/:id/create-account ────────────────────────────────────────
// إنشاء حساب للاعب قائم (نفس نظام nosait00001 + كلمة مرور قوية تُعرض مرة واحدة).
const createPlayerAccount = async (req, res, next) => {
  const { player, error } = await loadAuthorizedPlayer(req);
  if (error) return next(error);

  if (!(await isPortalEnabled(player.academyId))) {
    return res.status(403).json({
      success: false,
      code: 'PLAYER_PORTAL_DISABLED',
      message: 'بوابة اللاعب غير مفعّلة لهذه الأكاديمية. تواصل مع إدارة Nosait لتفعيلها.',
    });
  }

  const existing = await PlayerAccount.findOne({ playerId: player._id });
  if (existing) return next(new AppError('لدى هذا اللاعب حساب بالفعل', 409));

  const username = await PlayerAccount.generateUsername();
  const plainPassword = generateStrongPassword(10);
  const account = await PlayerAccount.create({
    playerId: player._id,
    academyId: player.academyId,
    username,
    password: plainPassword,
  });

  logger.info(`Player account created: ${username} for ${player.playerCode}`);
  logActivity(req, {
    actionType: 'CREATE_PLAYER_ACCOUNT', entityType: 'PLAYER_ACCOUNT',
    entityId: account._id, entityName: player.fullName, academyId: player.academyId,
  });

  return res.status(201).json({
    success: true,
    message: 'تم إنشاء حساب اللاعب بنجاح',
    data: { _id: account._id.toString(), username, password: plainPassword, isActive: true },
  });
};

// ─── PATCH /players/:id/password ─────────────────────────────────────────────
// تغيير كلمة المرور يدوياً (Password + Confirm يتحقق منها الـ router).
const changePlayerPassword = async (req, res, next) => {
  const { player, error } = await loadAuthorizedPlayer(req);
  if (error) return next(error);

  const account = await PlayerAccount.findOne({ playerId: player._id }).select('+password');
  if (!account) return next(new AppError('لا يوجد حساب لهذا اللاعب', 404));

  account.password = req.body.password; // يُشفَّر تلقائياً في pre('save')
  await account.save();

  logger.info(`Player account password changed: ${account.username}`);
  logActivity(req, {
    actionType: 'CHANGE_PLAYER_PASSWORD', entityType: 'PLAYER_ACCOUNT',
    entityId: account._id, entityName: player.fullName, academyId: player.academyId,
  });

  return sendSuccess(res, { message: 'تم تغيير كلمة المرور بنجاح' });
};

// ─── PATCH /players/:id/reset-password ───────────────────────────────────────
// توليد كلمة مرور عشوائية جديدة وإرجاعها مرة واحدة فقط.
const resetPlayerPassword = async (req, res, next) => {
  const { player, error } = await loadAuthorizedPlayer(req);
  if (error) return next(error);

  const account = await PlayerAccount.findOne({ playerId: player._id }).select('+password');
  if (!account) return next(new AppError('لا يوجد حساب لهذا اللاعب', 404));

  const plainPassword = generateStrongPassword(10);
  account.password = plainPassword; // يُشفَّر تلقائياً في pre('save')
  await account.save();

  logger.info(`Player account password reset: ${account.username}`);
  logActivity(req, {
    actionType: 'RESET_PLAYER_PASSWORD', entityType: 'PLAYER_ACCOUNT',
    entityId: account._id, entityName: player.fullName, academyId: player.academyId,
  });

  return sendSuccess(res, {
    data: { username: account.username, password: plainPassword },
    message: 'تم إعادة إنشاء كلمة المرور بنجاح',
  });
};

// ─── PATCH /players/:id/toggle-account ───────────────────────────────────────
// body: { isActive: boolean } — تعطيل/تفعيل حساب اللاعب.
const togglePlayerAccount = async (req, res, next) => {
  const { player, error } = await loadAuthorizedPlayer(req);
  if (error) return next(error);

  const account = await PlayerAccount.findOne({ playerId: player._id });
  if (!account) return next(new AppError('لا يوجد حساب لهذا اللاعب', 404));

  const isActive = req.body.isActive === true || req.body.isActive === 'true';
  account.isActive = isActive;
  await account.save();

  logger.info(`Player account ${isActive ? 'enabled' : 'disabled'}: ${account.username}`);
  logActivity(req, {
    actionType: isActive ? 'ENABLE_PLAYER_ACCOUNT' : 'DISABLE_PLAYER_ACCOUNT',
    entityType: 'PLAYER_ACCOUNT',
    entityId: account._id, entityName: player.fullName, academyId: player.academyId,
  });

  return sendSuccess(res, {
    data: { _id: account._id.toString(), username: account.username, isActive },
    message: isActive ? 'تم تفعيل الحساب بنجاح' : 'تم تعطيل الحساب بنجاح',
  });
};

// ─── GET /players/account-stats ──────────────────────────────────────────────
// إحصائية للوحة التحكم: عدد اللاعبين النشطين الذين لديهم/ليس لديهم حسابات.
const getAccountStats = async (req, res, next) => {
  let academyId;
  if (req.user.role === 'super_admin') {
    academyId = req.query.academyId;
    if (!academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  } else {
    academyId = req.user.academyId;
  }

  const [totalActive, accountPlayerIds, portalEnabled] = await Promise.all([
    Player.countDocuments({ academyId, isActive: true }),
    PlayerAccount.find({ academyId }).distinct('playerId'),
    isPortalEnabled(academyId),
  ]);

  const withAccount = await Player.countDocuments({
    academyId,
    isActive: true,
    _id: { $in: accountPlayerIds },
  });

  return sendSuccess(res, {
    data: {
      portalEnabled,
      withAccount,
      withoutAccount: Math.max(0, totalActive - withAccount),
    },
    message: 'تم جلب إحصائية حسابات اللاعبين',
  });
};

module.exports = {
  getPlayerAccount,
  createPlayerAccount,
  changePlayerPassword,
  resetPlayerPassword,
  togglePlayerAccount,
  getAccountStats,
};
