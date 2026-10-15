const mongoose = require('mongoose');
const TeamKit = require('../models/teamKit.model');
const KitBooking = require('../models/kitBooking.model');
const Player = require('../models/player.model');
const Academy = require('../models/academy.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const { KIT_SIZES } = require('../utils/kitSizes');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');
const { notify } = require('../utils/notificationService');

// حجز "نشط" يمنع حجزاً جديداً لنفس الطقم؛ المرفوض يسمح بإعادة الحجز.
const ACTIVE_STATUSES = ['pending_review', 'approved'];
const findActiveBooking = (academyId, playerId, kitId) =>
  KitBooking.findOne({ academyId, playerId, kitId, status: { $in: ACTIVE_STATUSES } });

// نفس نمط المتجر/الألبوم: super_admin وحده يمرّر academyId صراحةً،
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

const assertAccess = (req, item) => {
  if (
    req.user.role !== 'super_admin' &&
    item.academyId.toString() !== req.user.academyId?.toString()
  ) {
    throw new AppError('ليس لديك صلاحية للوصول إلى هذا العنصر', 403);
  }
};

const parsePrice = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

const parseSizes = (raw) => {
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch (_) {
      arr = raw.split(',').map((s) => s.trim());
    }
  }
  if (!Array.isArray(arr)) return null;
  const cleaned = arr.map((s) => String(s).trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  if (!cleaned.every((s) => KIT_SIZES.includes(s))) return null;
  return cleaned;
};

// ══════════════════════ الطقم (جهة المدير) ══════════════════════

// ─── GET /team-kit ────────────────────────────────────────────────────────────
const getKit = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  const kit = await TeamKit.findOne({ academyId });
  // آخر حجز للاعب على هذا الطقم — لعرض حالته (قيد المراجعة/مؤكد/مرفوض).
  const myBooking = kit
    ? await KitBooking.findOne({ academyId, playerId: req.player._id, kitId: kit._id })
      .sort({ created_at: -1 })
    : null;
  return sendSuccess(res, {
    data: kit ? { ...kit.toJSON(), myBooking: myBooking ? myBooking.toJSON() : null } : null,
    message: 'تم جلب طقم الفريق بنجاح',
  });
};

// ─── PUT /team-kit (إنشاء أو استبدال الطقم الفعّال للأكاديمية) ────────────────
const upsertKit = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);

  const name = String(req.body.name || '').trim();
  if (!name) return next(new AppError('اسم الطقم مطلوب', 400));

  const price = parsePrice(req.body.price);
  if (price === null) return next(new AppError('سعر الطقم غير صحيح', 400));

  const availableSizes = parseSizes(req.body.availableSizes);
  if (!availableSizes) return next(new AppError('يجب اختيار مقاس واحد على الأقل من القائمة المتاحة', 400));

  const existing = await TeamKit.findOne({ academyId }).select('+image_public_id');

  if (!existing && !req.file) {
    return next(new AppError('صورة الطقم مطلوبة', 400));
  }

  let kit;
  if (existing) {
    if (req.file) {
      if (existing.image_public_id) {
        await deleteImage(existing.image_public_id).catch(() => {});
      }
      existing.image_url = req.file.path;
      existing.image_public_id = req.file.filename;
    }
    existing.name = name;
    existing.price = price;
    existing.availableSizes = availableSizes;
    kit = await existing.save();
  } else {
    kit = await TeamKit.create({
      academyId,
      name,
      price,
      availableSizes,
      image_url: req.file.path,
      image_public_id: req.file.filename,
    });
  }

  logger.info(`Team kit upserted: ${kit._id} (academy ${academyId})`);
  logActivity(req, {
    actionType: 'UPSERT_TEAM_KIT', entityType: 'TEAM_KIT',
    entityId: kit._id, entityName: name, academyId,
  });
  return sendSuccess(res, { data: kit.toJSON(), message: 'تم حفظ طقم الفريق بنجاح' });
};

// ─── DELETE /team-kit ──────────────────────────────────────────────────────────
const deleteKit = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  const kit = await TeamKit.findOne({ academyId }).select('+image_public_id');
  if (!kit) return next(new AppError('لا يوجد طقم فريق لهذه الأكاديمية', 404));

  if (kit.image_public_id) {
    await deleteImage(kit.image_public_id).catch(() => {});
  }
  await kit.deleteOne();

  logActivity(req, {
    actionType: 'DELETE_TEAM_KIT', entityType: 'TEAM_KIT',
    entityId: kit._id, entityName: kit.name, academyId,
  });
  return sendSuccess(res, { message: 'تم حذف طقم الفريق بنجاح' });
};

// ══════════════════════ الحجوزات (جهة المدير) ══════════════════════

// ─── GET /team-kit/bookings?status=pending_review|approved|rejected ──────────
// نبني الاستجابة صراحةً (بدل sendPaginated) لإضافة pendingCount في الـ meta.
const getBookings = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  if (!mongoose.isValidObjectId(academyId)) {
    return next(new AppError('معرّف الأكاديمية غير صحيح', 400));
  }
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = { academyId };
  const validStatus = ['pending_review', 'approved', 'rejected'];
  if (req.query.status && validStatus.includes(req.query.status)) {
    filter.status = req.query.status;
  }
  // عدد كل مقاس ضمن الحالة المختارة (قبل فلتر المقاس) لأزرار الفرز.
  const statusFilter = { ...filter };
  if (req.query.size && KIT_SIZES.includes(req.query.size)) {
    filter.size = req.query.size;
  }

  const [items, total, pendingCount, sizeAgg] = await Promise.all([
    KitBooking.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
    KitBooking.countDocuments(filter),
    KitBooking.countDocuments({ academyId, status: 'pending_review' }),
    KitBooking.aggregate([
      { $match: { ...statusFilter, academyId: new mongoose.Types.ObjectId(String(academyId)) } },
      { $group: { _id: '$size', count: { $sum: 1 } } },
    ]),
  ]);
  const sizeCounts = {};
  for (const s of sizeAgg) if (s._id) sizeCounts[s._id] = s.count;

  return res.status(200).json({
    success: true,
    message: 'تم جلب حجوزات طقم الفريق بنجاح',
    data: items.map((i) => i.toJSON()),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
      pendingCount,
      sizeCounts,
    },
  });
};

// ─── PATCH /team-kit/bookings/:id/review ──────────────────────────────────────
// المدير يعدّل المقاس وحالة الدفع، ثم يوافق أو يرفض.
const reviewBooking = async (req, res, next) => {
  const booking = await KitBooking.findById(req.params.id);
  if (!booking) return next(new AppError('الحجز غير موجود', 404));
  assertAccess(req, booking);

  if (req.body.size !== undefined) {
    if (!KIT_SIZES.includes(req.body.size)) {
      return next(new AppError('المقاس غير صحيح', 400));
    }
    booking.size = req.body.size;
  }
  if (req.body.paymentStatus !== undefined) {
    if (!['unpaid', 'paid'].includes(req.body.paymentStatus)) {
      return next(new AppError('حالة الدفع غير صحيحة', 400));
    }
    booking.paymentStatus = req.body.paymentStatus;
  }
  if (req.body.paidAmount !== undefined) {
    const amount = parsePrice(req.body.paidAmount);
    if (amount === null) return next(new AppError('المبلغ المدفوع غير صحيح', 400));
    booking.paidAmount = amount;
  }

  const prevStatus = booking.status;
  const status = req.body.status;
  if (status !== undefined) {
    if (!['approved', 'rejected'].includes(status)) {
      return next(new AppError('حالة المراجعة غير صحيحة', 400));
    }
    booking.status = status;
    booking.reviewedBy = req.user._id;
    booking.reviewedAt = new Date();
    // الموافقة تعني أن إيصال الدفع راجعته الإدارة وقبلته: الحجز مدفوع،
    // والمبلغ المدفوع = سعر الطقم إن لم يُحدَّد مبلغ آخر.
    if (status === 'approved') {
      booking.paymentStatus = 'paid';
      if (!booking.paidAmount) booking.paidAmount = booking.price;
    }
  }

  await booking.save();

  if (status !== undefined && status !== prevStatus) {
    const approved = status === 'approved';
    notify({
      recipientType: 'player', recipientId: booking.playerId, academyId: booking.academyId,
      type: approved ? 'KIT_BOOKING_APPROVED' : 'KIT_BOOKING_REJECTED',
      title: approved ? 'تم تأكيد حجز الطقم' : 'تم رفض حجز الطقم',
      body: approved
        ? `تم تأكيد حجزك لطقم "${booking.kitName}" مقاس ${booking.size}`
        : `تم رفض حجزك لطقم "${booking.kitName}" — يمكنك الحجز مرة أخرى`,
      meta: { bookingId: booking._id.toString(), status },
    });
  }

  logActivity(req, {
    actionType: 'REVIEW_KIT_BOOKING', entityType: 'KIT_BOOKING',
    entityId: booking._id, entityName: booking.playerName, academyId: booking.academyId,
  });
  return sendSuccess(res, { data: booking.toJSON(), message: 'تم تحديث الحجز بنجاح' });
};

// ─── POST /team-kit/bookings (المدير يضيف حجز مباشرة للاعب) ──────────────────
const createManagerBooking = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);

  const kit = await TeamKit.findOne({ academyId });
  if (!kit) return next(new AppError('لا يوجد طقم فريق مُعرَّف لهذه الأكاديمية بعد', 404));

  const player = await Player.findOne({ _id: req.body.playerId, academyId });
  if (!player) return next(new AppError('اللاعب غير موجود', 404));
  if (await findActiveBooking(academyId, player._id, kit._id)) {
    return next(new AppError('هذا اللاعب لديه حجز قائم لهذا الطقم بالفعل', 409));
  }

  const size = req.body.size;
  if (!kit.availableSizes.includes(size)) {
    return next(new AppError('المقاس غير متاح لهذا الطقم', 400));
  }

  const paymentStatus = ['unpaid', 'paid'].includes(req.body.paymentStatus)
    ? req.body.paymentStatus
    : 'unpaid';
  const paidAmount = req.body.paidAmount !== undefined
    ? (parsePrice(req.body.paidAmount) ?? 0)
    : 0;

  const academy = await Academy.findById(academyId).select('currency');

  const booking = await KitBooking.create({
    academyId,
    kitId: kit._id,
    kitName: kit.name,
    price: kit.price,
    currency: (academy && academy.currency) || 'EGP',
    playerId: player._id,
    playerName: player.fullName,
    size,
    status: 'approved',
    paymentStatus,
    paidAmount,
    source: 'manager',
    reviewedBy: req.user._id,
    reviewedAt: new Date(),
  });

  logger.info(`Kit booking created by manager: ${booking._id} (academy ${academyId})`);
  logActivity(req, {
    actionType: 'CREATE_KIT_BOOKING', entityType: 'KIT_BOOKING',
    entityId: booking._id, entityName: player.fullName, academyId,
  });
  return sendSuccess(res, {
    data: booking.toJSON(),
    message: 'تم إضافة الحجز بنجاح',
    statusCode: 201,
  });
};

// ══════════════════════ جهة اللاعب ══════════════════════

// ─── DELETE /team-kit/bookings/:id (حذف نهائي + صورة الإيصال) ─────────────────
const deleteBooking = async (req, res, next) => {
  const booking = await KitBooking.findById(req.params.id).select('+receipt_public_id');
  if (!booking) return next(new AppError('الحجز غير موجود', 404));
  assertAccess(req, booking);

  if (booking.receipt_public_id) {
    await deleteImage(booking.receipt_public_id).catch(() => {});
  }
  await booking.deleteOne();

  logActivity(req, {
    actionType: 'DELETE_KIT_BOOKING', entityType: 'KIT_BOOKING',
    entityId: booking._id, entityName: booking.playerName, academyId: booking.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف الحجز' });
};

// ─── GET /player/team-kit (قراءة فقط — أكاديمية اللاعب حصراً) ────────────────
const getPlayerKit = async (req, res, next) => {
  const academyId = req.player.academyId;
  const kit = await TeamKit.findOne({ academyId });
  return sendSuccess(res, {
    data: kit ? kit.toJSON() : null,
    message: 'تم جلب طقم الفريق بنجاح',
  });
};

// ─── POST /player/team-kit/bookings (لاعب ينشئ حجز) ───────────────────────────
const createPlayerBooking = async (req, res, next) => {
  const player = req.player;
  const academyId = player.academyId;

  // الصورة تُرفع إلى Cloudinary قبل وصولنا هنا (multer)، فأي رفض بعد ذلك
  // يجب أن يحذفها وإلا تراكمت صور يتيمة — نفس نمط طلبات الانضمام.
  const receiptFile = req.file;
  const reject = async (message, statusCode = 400) => {
    if (receiptFile?.filename) {
      await deleteImage(receiptFile.filename).catch(() => {});
    }
    return next(new AppError(message, statusCode));
  };

  if (!receiptFile) {
    return next(new AppError('صورة إيصال الدفع مطلوبة', 400));
  }

  const kit = await TeamKit.findOne({ academyId });
  if (!kit) return reject('لا يوجد طقم فريق متاح حالياً', 404);

  const size = req.body.size;
  if (!kit.availableSizes.includes(size)) {
    return reject('المقاس غير متاح لهذا الطقم');
  }
  if (await findActiveBooking(academyId, player._id, kit._id)) {
    return reject('لديك حجز قائم لهذا الطقم بالفعل', 409);
  }

  const academy = await Academy.findById(academyId).select('currency');

  const booking = await KitBooking.create({
    academyId,
    kitId: kit._id,
    kitName: kit.name,
    price: kit.price,
    currency: (academy && academy.currency) || 'EGP',
    playerId: player._id,
    playerName: player.fullName,
    size,
    receipt_url: receiptFile.path,
    receipt_public_id: receiptFile.filename,
    status: 'pending_review',
    source: 'player',
  });

  logger.info(`Kit booking created by player: ${booking._id} (academy ${academyId}, player ${player._id})`);
  return sendSuccess(res, {
    data: booking.toJSON(),
    message: 'تم إرسال طلب الحجز، بانتظار موافقة إدارة الأكاديمية',
    statusCode: 201,
  });
};

module.exports = {
  getKit,
  upsertKit,
  deleteKit,
  getBookings,
  reviewBooking,
  createManagerBooking,
  getPlayerKit,
  createPlayerBooking,
  deleteBooking,
};
