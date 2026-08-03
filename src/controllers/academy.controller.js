const Academy = require('../models/academy.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');

// Normalize the `sports` field coming from multipart/form-data.
// Accepts: a real array, a JSON-encoded array string, or a comma-separated string.
const parseSports = (raw) => {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
    } catch (_) {
      // not JSON — fall through to comma-split
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
};

const getAcademies = async (req, res, next) => {
  let query = { isActive: true };

  // أي مستخدم غير super_admin يرى أكاديميته فقط.
  if (req.user.role !== 'super_admin') {
    query._id = req.user.academyId;
  }

  const academies = await Academy.find(query)
    .populate('player_count')
    .sort({ created_at: -1 });

  return sendSuccess(res, { data: academies, message: 'تم جلب الأكاديميات بنجاح' });
};

const getAcademyById = async (req, res, next) => {
  const academy = await Academy.findById(req.params.id).populate('player_count');

  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));

  if (req.user.role !== 'super_admin' &&
      academy._id.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى هذه الأكاديمية', 403));
  }

  return sendSuccess(res, { data: academy });
};

const createAcademy = async (req, res, next) => {
  const { name, phone, address, currency } = req.body;
  const sports = parseSports(req.body.sports);

  const academy = await Academy.create({
    name,
    phone,
    address,
    currency: currency || 'EGP',
    ...(sports && sports.length ? { sports } : {}),
    logo_url: req.file ? req.file.path : null,
    logo_public_id: req.file ? req.file.filename : null,
  });

  logger.info(`Academy created: ${academy.name} by ${req.user.email}`);
  return sendSuccess(res, { data: academy, message: 'تم إنشاء الأكاديمية بنجاح', statusCode: 201 });
};

const updateAcademy = async (req, res, next) => {
  const academy = await Academy.findById(req.params.id).select('+logo_public_id');
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));

  if (req.user.role !== 'super_admin' &&
      academy._id.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذه الأكاديمية', 403));
  }

  if (req.file) {
    if (academy.logo_public_id) {
      await deleteImage(academy.logo_public_id).catch(() => {});
    }
    academy.logo_url = req.file.path;
    academy.logo_public_id = req.file.filename;
  }

  if (req.body.name) academy.name = req.body.name;
  if (req.body.phone) academy.phone = req.body.phone;
  if (req.body.address) academy.address = req.body.address;
  if (req.body.currency) academy.currency = req.body.currency;
  if (req.body.websiteUrl !== undefined) academy.websiteUrl = req.body.websiteUrl;
  if (req.body.facebookUrl !== undefined) academy.facebookUrl = req.body.facebookUrl;
  if (req.body.tiktokUrl !== undefined) academy.tiktokUrl = req.body.tiktokUrl;
  if (req.body.instagramUrl !== undefined) academy.instagramUrl = req.body.instagramUrl;

  const sports = parseSports(req.body.sports);
  if (sports && sports.length) academy.sports = sports;

  await academy.save();
  logger.info(`Academy updated: ${academy.name} by ${req.user.email}`);
  logActivity(req, {
    actionType: 'UPDATE_ACADEMY', entityType: 'ACADEMY',
    entityId: academy._id, entityName: academy.name, academyId: academy._id,
  });
  return sendSuccess(res, { data: academy, message: 'تم تحديث الأكاديمية بنجاح' });
};

const deleteAcademy = async (req, res, next) => {
  const academy = await Academy.findById(req.params.id).select('+logo_public_id');
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));

  if (academy.logo_public_id) {
    await deleteImage(academy.logo_public_id).catch(() => {});
  }

  academy.isActive = false;
  await academy.save();

  logger.info(`Academy deleted: ${academy.name} by ${req.user.email}`);
  return sendSuccess(res, { message: 'تم حذف الأكاديمية بنجاح' });
};

const deleteAcademyLogo = async (req, res, next) => {
  const academy = await Academy.findById(req.params.id).select('+logo_public_id');
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));
  if (!academy.logo_public_id) return next(new AppError('لا توجد صورة لحذفها', 400));

  await deleteImage(academy.logo_public_id);
  academy.logo_url = null;
  academy.logo_public_id = null;
  await academy.save();

  return sendSuccess(res, { message: 'تم حذف الشعار بنجاح' });
};

module.exports = { getAcademies, getAcademyById, createAcademy, updateAcademy, deleteAcademy, deleteAcademyLogo };
