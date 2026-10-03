const mongoose = require('mongoose');
const Offer = require('../models/offer.model');
const Academy = require('../models/academy.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { notifyAcademyPlayers } = require('../utils/notificationService');
const { todayFor } = require('./attendance.controller');

// العروض والخصومات:
//  • الحساب الرئيسي يضيف عرضاً لكل الفروع (academyIds فارغة) أو لفروع يختارها.
//  • مدير الفرع يضيف عروضاً لفرعه فقط، ويعدّل ما أضافه لفرعه.
//  • اللاعب يرى العروض السارية لفرعه (أو لكل الفروع) — تختفي بعد تاريخ النهاية.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseIds = (raw) => {
  if (raw === undefined || raw === null || raw === '') return [];
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch (_) {
      list = raw.split(',');
    }
  }
  return [...new Set((Array.isArray(list) ? list : [list]).map((s) => String(s).trim()))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id));
};

const parseDiscount = (body) => {
  const type = ['percent', 'amount'].includes(body.discountType) ? body.discountType : null;
  if (!type) return { discountType: null, discountValue: null };
  const value = Number(body.discountValue);
  if (!Number.isFinite(value) || value < 0) throw new AppError('قيمة الخصم غير صحيحة', 400);
  if (type === 'percent' && value > 100) throw new AppError('نسبة الخصم لا يمكن أن تتجاوز 100%', 400);
  return { discountType: type, discountValue: value };
};

// العرض الذي أضافه مدير فرع لفرعه وحده يعدّله هو؛ غيره للحساب الرئيسي فقط.
const canEdit = (req, offer) => {
  if (req.user.role === 'super_admin') return true;
  if (req.user.role !== 'academy_admin') return false;
  const own = req.user.academyId?.toString();
  return offer.academyIds.length === 1 && offer.academyIds[0].toString() === own;
};

// الفروع المستهدفة: مدير الفرع ⇒ فرعه حتماً؛ الحساب الرئيسي ⇒ ما اختاره (فارغ = الكل).
const targetAcademies = async (req) => {
  if (req.user.role !== 'super_admin') return [req.user.academyId];
  const ids = parseIds(req.body.academyIds);
  if (!ids.length) return [];
  const found = await Academy.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) throw new AppError('بعض الفروع المختارة غير موجودة', 400);
  return ids;
};

const withNames = async (offers, req) => {
  const ids = [...new Set(offers.flatMap((o) => o.academyIds.map(String)))];
  const academies = await Academy.find({ _id: { $in: ids } }).select('name');
  const names = new Map(academies.map((a) => [a._id.toString(), a.name]));
  return offers.map((o) => ({
    ...o.toJSON(),
    academyNames: o.academyIds.map((id) => names.get(id.toString()) || ''),
    canEdit: req ? canEdit(req, o) : false,
  }));
};

const cleanupUpload = async (req) => {
  if (req.file?.filename) await deleteImage(req.file.filename).catch(() => {});
};

// ─── GET /offers (الإدارة) ───────────────────────────────────────────────────
const listOffers = async (req, res) => {
  const filter = {};
  if (req.user.role !== 'super_admin') {
    filter.$or = [{ academyIds: { $size: 0 } }, { academyIds: req.user.academyId }];
  }
  const offers = await Offer.find(filter).sort({ endDate: -1, created_at: -1 }).limit(300);
  return sendSuccess(res, { data: await withNames(offers, req), message: 'تم جلب العروض بنجاح' });
};

// ─── POST /offers ────────────────────────────────────────────────────────────
const createOffer = async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) throw new AppError('عنوان العرض مطلوب', 400);
    const { startDate, endDate } = req.body;
    if (!DATE_RE.test(startDate || '') || !DATE_RE.test(endDate || '')) {
      throw new AppError('تاريخ البداية والنهاية مطلوبان', 400);
    }
    if (endDate < startDate) throw new AppError('تاريخ النهاية يجب أن يكون بعد تاريخ البداية', 400);

    const academyIds = await targetAcademies(req);
    const offer = await Offer.create({
      title,
      details: String(req.body.details || '').trim(),
      ...parseDiscount(req.body),
      startDate,
      endDate,
      academyIds,
      image_url: req.file ? req.file.path : null,
      image_public_id: req.file ? req.file.filename : null,
      createdBy: req.user._id,
    });

    logger.info(`Offer created: ${offer._id} by ${req.user._id}`);
    // إشعار لاعبي الفروع المستهدفة (فارغة = كل الفروع).
    notifyAcademyPlayers({
      academyIds,
      type: 'OFFER_ADDED',
      title: `عرض جديد: ${title} 🎁`,
      body: offer.details.length > 120 ? `${offer.details.slice(0, 120)}…` : offer.details,
      meta: { offerId: offer._id.toString() },
    });

    const [data] = await withNames([offer], req);
    return sendSuccess(res, { data, message: 'تمت إضافة العرض بنجاح', statusCode: 201 });
  } catch (err) {
    await cleanupUpload(req);
    return next(err);
  }
};

// ─── PATCH /offers/:id ───────────────────────────────────────────────────────
const updateOffer = async (req, res, next) => {
  try {
    const offer = await Offer.findById(req.params.id).select('+image_public_id');
    if (!offer) throw new AppError('العرض غير موجود', 404);
    if (!canEdit(req, offer)) throw new AppError('ليس لديك صلاحية لتعديل هذا العرض', 403);

    if (req.body.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) throw new AppError('عنوان العرض مطلوب', 400);
      offer.title = title;
    }
    if (req.body.details !== undefined) offer.details = String(req.body.details).trim();
    if (req.body.discountType !== undefined) Object.assign(offer, parseDiscount(req.body));
    if (req.body.startDate !== undefined) {
      if (!DATE_RE.test(req.body.startDate)) throw new AppError('تاريخ البداية غير صحيح', 400);
      offer.startDate = req.body.startDate;
    }
    if (req.body.endDate !== undefined) {
      if (!DATE_RE.test(req.body.endDate)) throw new AppError('تاريخ النهاية غير صحيح', 400);
      offer.endDate = req.body.endDate;
    }
    if (req.body.isActive !== undefined) {
      offer.isActive = req.body.isActive === true || String(req.body.isActive) === 'true';
    }
    if (req.body.academyIds !== undefined && req.user.role === 'super_admin') {
      offer.academyIds = await targetAcademies(req);
    }
    const removeImage = String(req.body.removeImage) === 'true';
    if (req.file || removeImage) {
      if (offer.image_public_id) await deleteImage(offer.image_public_id).catch(() => {});
      offer.image_url = req.file ? req.file.path : null;
      offer.image_public_id = req.file ? req.file.filename : null;
    }
    await offer.save();

    const [data] = await withNames([offer], req);
    return sendSuccess(res, { data, message: 'تم تحديث العرض بنجاح' });
  } catch (err) {
    await cleanupUpload(req);
    return next(err);
  }
};

// ─── DELETE /offers/:id ──────────────────────────────────────────────────────
const deleteOffer = async (req, res, next) => {
  const offer = await Offer.findById(req.params.id).select('+image_public_id');
  if (!offer) return next(new AppError('العرض غير موجود', 404));
  if (!canEdit(req, offer)) return next(new AppError('ليس لديك صلاحية لحذف هذا العرض', 403));
  if (offer.image_public_id) await deleteImage(offer.image_public_id).catch(() => {});
  await offer.deleteOne();
  return sendSuccess(res, { message: 'تم حذف العرض' });
};

// ─── GET /player/offers — العروض السارية لفرع اللاعب ─────────────────────────
const getPlayerOffers = async (req, res) => {
  // تواريخ العرض مخزّنة منتصف ليل UTC؛ "اليوم" بنفس الصيغة يجعل النهاية شاملة.
  const today = new Date(todayFor(req));
  const offers = await Offer.find({
    isActive: true,
    startDate: { $lte: today },
    endDate: { $gte: today },
    $or: [{ academyIds: { $size: 0 } }, { academyIds: req.player.academyId }],
  }).sort({ endDate: 1 });
  return sendSuccess(res, {
    data: offers.map((o) => o.toJSON()),
    message: 'تم جلب العروض بنجاح',
  });
};

module.exports = { listOffers, createOffer, updateOffer, deleteOffer, getPlayerOffers };
