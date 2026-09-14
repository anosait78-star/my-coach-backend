const PlayerAccount = require('../models/playerAccount.model');
const Academy = require('../models/academy.model');
const { checkPlayerPortal, portalDisabledMessage } = require('../utils/playerPortal');
const AppError = require('../utils/AppError');
const { generatePlayerToken } = require('../utils/jwt');
const { sendSuccess } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { memberJson, academyNameMap } = require('./family.controller');

// يبني حمولة اللاعب الموحّدة للاستجابات.
const buildPlayerPayload = (account, academyName) => {
  const player = account.playerId;
  return {
    accountId: account._id.toString(),
    username: account.username,
    playerId: player?._id?.toString() || null,
    fullName: player?.fullName || '',
    playerCode: player?.playerCode || '',
    image_url: player?.image_url || null,
    academy_id: account.academyId?.toString() || null,
    academy_name: academyName || '',
    registrationStatus: player?.registrationStatus || 'approved',
    rejectionReason: player?.registrationStatus === 'rejected' ? (player?.rejectionReason || null) : null,
  };
};

// POST /api/v1/auth/player/login  (عام)
const playerLogin = async (req, res, next) => {
  const { username, password } = req.body;

  const account = await PlayerAccount.findOne({ username: String(username).toLowerCase().trim() })
    .select('+password')
    .populate('playerId');

  if (!account || !(await account.comparePassword(password))) {
    return next(new AppError('اسم المستخدم أو كلمة المرور غير صحيحة', 401));
  }
  if (!account.isActive) {
    // كود صريح للواجهة: الحساب معطّل من الأكاديمية.
    return res.status(403).json({
      success: false,
      code: 'ACCOUNT_DISABLED',
      message: 'تم تعطيل هذا الحساب. يرجى التواصل مع أكاديميتك.',
    });
  }
  if (!account.playerId || account.playerId.isActive === false) {
    return next(new AppError('حساب اللاعب غير متاح', 403));
  }

  // بوابة اللاعب مرهونة بميزة playerPortalEnabled واشتراك حي للأكاديمية.
  const portal = await checkPlayerPortal(account.academyId);
  if (!portal.active) {
    return res.status(403).json({
      success: false,
      code: portal.code,
      message: portalDisabledMessage(portal.code),
    });
  }

  const academy = await Academy.findById(account.academyId).select('name');
  const token = generatePlayerToken(account._id);

  logger.info(`Player logged in: ${account.username}`);

  return res.status(200).json({
    success: true,
    message: 'تم تسجيل الدخول بنجاح',
    token,
    data: buildPlayerPayload(account, academy?.name),
  });
};

// GET /api/v1/auth/player/me  (protectPlayer)
const playerMe = async (req, res, next) => {
  const account = req.playerAccount;
  const academy = await Academy.findById(account.academyId).select('name');
  return sendSuccess(res, { data: buildPlayerPayload(account, academy?.name) });
};

// GET /api/v1/auth/player/family  (protectPlayer)
// باقي حسابات عائلة الحساب الحالي (فارغة إن لم يكن في عائلة).
const playerFamily = async (req, res) => {
  const account = req.playerAccount;
  if (!account.familyId) return sendSuccess(res, { data: [] });

  const others = await PlayerAccount.find({
    familyId: account.familyId,
    _id: { $ne: account._id },
    isActive: true,
  })
    .populate('playerId', 'fullName playerCode image_url')
    .sort({ created_at: 1 });

  const names = await academyNameMap(others);
  return sendSuccess(res, {
    data: others.filter((a) => a.playerId).map((a) => memberJson(a, names)),
  });
};

// POST /api/v1/auth/player/switch  { accountId }  (protectPlayer)
// يبدّل لحساب آخر في نفس العائلة بلا كلمة مرور — نفس فحوص الدخول العادي
// على الحساب الهدف، ويعيد نفس شكل استجابة /login.
const playerSwitch = async (req, res, next) => {
  const current = req.playerAccount;
  const targetId = String(req.body.accountId || '');

  if (!current.familyId) {
    return next(new AppError('هذا الحساب ليس ضمن عائلة', 403));
  }

  const target = await PlayerAccount.findOne({
    _id: targetId,
    familyId: current.familyId,
  }).populate('playerId');
  if (!target) {
    return next(new AppError('لا يمكن التبديل إلى هذا الحساب', 403));
  }
  if (!target.isActive) {
    return res.status(403).json({
      success: false,
      code: 'ACCOUNT_DISABLED',
      message: 'الحساب المطلوب معطّل.',
    });
  }
  if (!target.playerId || target.playerId.isActive === false) {
    return next(new AppError('حساب اللاعب غير متاح', 403));
  }

  const portal = await checkPlayerPortal(target.academyId);
  if (!portal.active) {
    return res.status(403).json({
      success: false,
      code: portal.code,
      message: portalDisabledMessage(portal.code),
    });
  }

  const academy = await Academy.findById(target.academyId).select('name');
  logger.info(`Player account switch: ${current.username} -> ${target.username}`);

  return res.status(200).json({
    success: true,
    message: 'تم التبديل بنجاح',
    token: generatePlayerToken(target._id),
    data: buildPlayerPayload(target, academy?.name),
  });
};

module.exports = { playerLogin, playerMe, playerFamily, playerSwitch };
