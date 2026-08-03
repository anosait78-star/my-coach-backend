const Player = require('../models/player.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');

// إدارة اللاعب لصورته الشخصية من داخل بوابة اللاعب (protectPlayer).
// مسارات الإدارة `/players/:id/image` تبقى كما هي لمدير الأكاديمية — هذه
// نسخة موازية يملك فيها اللاعب صورته هو فقط، فلا حاجة لتمرير معرّف.

// اللاعب المرفق بالتوكن، مُعاد التحميل مع الحقل المخفي image_public_id.
const loadOwnPlayer = async (req) =>
  Player.findById(req.player._id).select('+image_public_id');

// PUT /api/v1/player/photo  (multipart: image)
const updateMyPhoto = async (req, res, next) => {
  if (!req.file) return next(new AppError('الصورة مطلوبة', 400));

  const player = await loadOwnPlayer(req);
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  // نفس منطق استبدال الصورة في player.controller: نحذف القديمة من Cloudinary
  // ثم نثبّت الجديدة. فشل الحذف لا يُبطل الرفع الناجح.
  if (player.image_public_id) {
    await deleteImage(player.image_public_id).catch(() => {});
  }
  player.image_url = req.file.path;
  player.image_public_id = req.file.filename;
  await player.save();

  logger.info(`Player photo updated by player: ${player.playerCode}`);
  return sendSuccess(res, {
    data: { image_url: player.image_url },
    message: 'تم تحديث الصورة بنجاح',
  });
};

// DELETE /api/v1/player/photo
const deleteMyPhoto = async (req, res, next) => {
  const player = await loadOwnPlayer(req);
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  if (!player.image_public_id) {
    return next(new AppError('لا توجد صورة لحذفها', 400));
  }

  await deleteImage(player.image_public_id);
  player.image_url = null;
  player.image_public_id = null;
  await player.save();

  logger.info(`Player photo deleted by player: ${player.playerCode}`);
  return sendSuccess(res, { data: { image_url: null }, message: 'تم حذف الصورة بنجاح' });
};

module.exports = { updateMyPhoto, deleteMyPhoto };
