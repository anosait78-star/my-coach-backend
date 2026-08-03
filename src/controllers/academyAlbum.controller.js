const AcademyAlbum = require('../models/academyAlbum.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');

// نفس نمط المجموعات/اللاعبين: super_admin وحده يمرّر academyId صراحةً،
// وكل من عداه مُقيَّد حتمياً بأكاديميته.
const resolveAcademyFilter = (req) => {
  if (req.user.role === 'super_admin') {
    if (!req.query.academyId) {
      throw new AppError('معرّف الأكاديمية مطلوب', 400);
    }
    return req.query.academyId;
  }
  return req.user.academyId;
};

// حارس وصول لصورة تخصّ أكاديمية أخرى. super_admin وحده يتجاوز القيد.
const assertAccess = (req, item) => {
  if (
    req.user.role !== 'super_admin' &&
    item.academyId.toString() !== req.user.academyId?.toString()
  ) {
    throw new AppError('ليس لديك صلاحية للوصول إلى هذه الصورة', 403);
  }
};

// صفحة موحّدة لجلب ألبوم أكاديمية معيّنة (Pagination + Lazy Loading).
const paginateAlbum = async (academyId, req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    AcademyAlbum.find({ academyId })
      .sort({ order: 1, created_at: -1 })
      .skip(skip)
      .limit(limit),
    AcademyAlbum.countDocuments({ academyId }),
  ]);

  return sendPaginated(res, {
    data: items.map((i) => i.toJSON()),
    total,
    page,
    limit,
    message: 'تم جلب ألبوم الأكاديمية بنجاح',
  });
};

// ─── GET /academy-album (جهة المدير) ─────────────────────────────────────────
const getAlbum = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  return paginateAlbum(academyId, req, res);
};

// ─── GET /player/album (جهة اللاعب — قراءة فقط لأكاديميته) ────────────────────
const getPlayerAlbum = async (req, res, next) => {
  // req.player من protectPlayer — عزل صارم: أكاديمية اللاعب فقط.
  return paginateAlbum(req.player.academyId, req, res);
};

// ─── POST /academy-album ─────────────────────────────────────────────────────
const createAlbumImage = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  if (!req.file) return next(new AppError('الصورة مطلوبة', 400));

  const title = String(req.body.title || '').trim();
  if (!title) return next(new AppError('العنوان مطلوب', 400));

  const item = await AcademyAlbum.create({
    academyId,
    title,
    description: String(req.body.description || '').trim(),
    image_url: req.file.path,
    image_public_id: req.file.filename,
  });

  logger.info(`Album image added: ${item._id} (academy ${academyId})`);
  logActivity(req, {
    actionType: 'CREATE_ALBUM_IMAGE', entityType: 'ALBUM',
    entityId: item._id, entityName: title, academyId,
  });
  return sendSuccess(res, {
    data: item.toJSON(),
    message: 'تمت إضافة الصورة بنجاح',
    statusCode: 201,
  });
};

// ─── PATCH /academy-album/:id (تعديل العنوان/الوصف) ──────────────────────────
const updateAlbumImage = async (req, res, next) => {
  const item = await AcademyAlbum.findById(req.params.id);
  if (!item) return next(new AppError('الصورة غير موجودة', 404));
  assertAccess(req, item);

  if (req.body.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) return next(new AppError('العنوان مطلوب', 400));
    item.title = title;
  }
  if (req.body.description !== undefined) {
    item.description = String(req.body.description).trim();
  }
  await item.save();

  logActivity(req, {
    actionType: 'UPDATE_ALBUM_IMAGE', entityType: 'ALBUM',
    entityId: item._id, entityName: item.title, academyId: item.academyId,
  });
  return sendSuccess(res, { data: item.toJSON(), message: 'تم تحديث الصورة بنجاح' });
};

// ─── DELETE /academy-album/:id ───────────────────────────────────────────────
const deleteAlbumImage = async (req, res, next) => {
  const item = await AcademyAlbum.findById(req.params.id).select('+image_public_id');
  if (!item) return next(new AppError('الصورة غير موجودة', 404));
  assertAccess(req, item);

  if (item.image_public_id) {
    await deleteImage(item.image_public_id).catch(() => {});
  }
  await item.deleteOne();

  logActivity(req, {
    actionType: 'DELETE_ALBUM_IMAGE', entityType: 'ALBUM',
    entityId: item._id, entityName: item.title, academyId: item.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف الصورة بنجاح' });
};

// ─── PATCH /academy-album/reorder ────────────────────────────────────────────
const reorderAlbum = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
  if (!ids || ids.length === 0) {
    return next(new AppError('قائمة المعرّفات مطلوبة', 400));
  }

  // نحدّث ترتيب صور هذه الأكاديمية فقط — عزل صارم عبر academyId في الفلتر.
  await Promise.all(
    ids.map((id, index) =>
      AcademyAlbum.updateOne({ _id: id, academyId }, { $set: { order: index } })
    )
  );

  return sendSuccess(res, { message: 'تم تحديث ترتيب الصور بنجاح' });
};

module.exports = {
  getAlbum,
  getPlayerAlbum,
  createAlbumImage,
  updateAlbumImage,
  deleteAlbumImage,
  reorderAlbum,
};
