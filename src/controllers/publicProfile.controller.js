const crypto = require('crypto');
const Player = require('../models/player.model');
const Academy = require('../models/academy.model');
const PlayerVideo = require('../models/playerVideo.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');

// رمز عشوائي غير قابل للتخمين — لا يُشتق من معرّف اللاعب.
const newToken = () => crypto.randomBytes(18).toString('base64url');

// نفس قاعدة getPlayerById: غير السوبر أدمن مُقيَّد بأكاديميته.
const loadManagedPlayer = async (req, next) => {
  const player = await Player.findById(req.params.id).select('+shareToken');
  if (!player) {
    next(new AppError('اللاعب غير موجود', 404));
    return null;
  }
  if (req.user.role !== 'super_admin' &&
      player.academyId.toString() !== req.user.academyId?.toString()) {
    next(new AppError('ليس لديك صلاحية للوصول إلى هذا اللاعب', 403));
    return null;
  }
  return player;
};

const shareInfo = (player) => ({
  token: player.shareToken || null,
  bio: player.bio || '',
});

// ─── GET /players/:id/share ──────────────────────────────────────────────────
const getShareInfo = async (req, res, next) => {
  const player = await loadManagedPlayer(req, next);
  if (!player) return;
  return sendSuccess(res, { data: shareInfo(player), message: 'تم جلب بيانات المشاركة' });
};

// ─── POST /players/:id/share  { regenerate?: true } ──────────────────────────
// ينشئ الرابط إن لم يوجد؛ regenerate يُبطل الرابط القديم بإصدار رمز جديد.
const enableShare = async (req, res, next) => {
  const player = await loadManagedPlayer(req, next);
  if (!player) return;
  if (!player.shareToken || req.body?.regenerate === true) {
    player.shareToken = newToken();
    await player.save();
  }
  return sendSuccess(res, { data: shareInfo(player), message: 'تم تجهيز رابط المشاركة' });
};

// ─── DELETE /players/:id/share — إيقاف الرابط ────────────────────────────────
const disableShare = async (req, res, next) => {
  const player = await loadManagedPlayer(req, next);
  if (!player) return;
  // إزالة الحقل نفسه لا ضبطه null (راجع فهرس shareToken في الموديل).
  player.shareToken = undefined;
  await player.save();
  return sendSuccess(res, { data: shareInfo(player), message: 'تم إيقاف رابط المشاركة' });
};

// ─── PATCH /players/:id/bio  { bio } ─────────────────────────────────────────
const updateBio = async (req, res, next) => {
  const player = await loadManagedPlayer(req, next);
  if (!player) return;
  player.bio = String(req.body.bio || '').trim();
  await player.save();
  return sendSuccess(res, { data: shareInfo(player), message: 'تم حفظ النبذة' });
};

// ─── GET /public/players/:token (عام) ────────────────────────────────────────
// عرض فقط: بدون اشتراكات أو تقييمات أو أرقام تواصل أو بيانات ولي الأمر.
const getPublicProfile = async (req, res, next) => {
  const token = String(req.params.token || '');
  if (token.length < 16) return next(new AppError('الرابط غير صالح', 404));

  const player = await Player.findOne({
    shareToken: token,
    isActive: true,
    ...Player.APPROVED_ONLY,
  });
  if (!player) return next(new AppError('هذا الرابط غير متاح', 404));

  const [academy, videos] = await Promise.all([
    Academy.findById(player.academyId).select('name logo_url'),
    PlayerVideo.find({ playerId: player._id }).sort({ created_at: -1 }).limit(50),
  ]);

  return sendSuccess(res, {
    message: 'تم جلب البروفايل',
    data: {
      fullName: player.fullName,
      image_url: player.image_url || null,
      bio: player.bio || '',
      birthYear: player.birthDate ? new Date(player.birthDate).getFullYear() : null,
      sport: player.sport || null,
      academyName: academy?.name || '',
      academyLogoUrl: academy?.logo_url || null,
      videos: videos.map((v) => ({
        _id: v._id.toString(),
        title: v.title,
        description: v.description || '',
        url: v.url,
        provider: v.provider,
        videoKey: v.videoKey || '',
        thumbnailUrl: v.thumbnailUrl || '',
        created_at: v.created_at,
      })),
    },
  });
};

module.exports = {
  getShareInfo,
  enableShare,
  disableShare,
  updateBio,
  getPublicProfile,
};
