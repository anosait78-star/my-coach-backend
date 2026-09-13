const RenewalRequest = require('../models/renewalRequest.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { notify } = require('../utils/notificationService');

// ─── POST /player/renewal-requests (لاعب يرسل طلب تجديد + إيصال) ─────────────
const createPlayerRenewalRequest = async (req, res, next) => {
  const player = req.player;
  const receiptFile = req.file;

  if (!receiptFile) {
    return next(new AppError('صورة إيصال الدفع مطلوبة', 400));
  }

  // طلب واحد معلّق لكل لاعب — والصورة المرفوعة للتو تُحذف حتى لا تبقى يتيمة.
  const pending = await RenewalRequest.exists({ playerId: player._id, status: 'pending' });
  if (pending) {
    await deleteImage(receiptFile.filename).catch(() => {});
    return next(new AppError('لديك طلب تجديد قيد المراجعة بالفعل', 409));
  }

  const request = await RenewalRequest.create({
    academyId: player.academyId,
    playerId: player._id,
    receipt_url: receiptFile.path,
    receipt_public_id: receiptFile.filename,
    note: String(req.body.note || '').trim(),
  });

  logger.info(`Renewal request created: ${request._id} (player ${player._id})`);
  return sendSuccess(res, {
    data: request.toJSON(),
    message: 'تم إرسال طلب التجديد، بانتظار مراجعة الإدارة',
    statusCode: 201,
  });
};

// يسطّح الـ populate لشكل ثابت يقرأه الفرونت مباشرة.
const toAdminJson = (r) => ({
  _id: r._id.toString(),
  status: r.status,
  note: r.note || '',
  rejectionReason: r.rejectionReason || '',
  receipt_url: r.receipt_url,
  created_at: r.created_at,
  reviewedAt: r.reviewedAt,
  academyId: r.academyId?._id?.toString() || r.academyId?.toString(),
  academyName: r.academyId?.name || '',
  playerId: r.playerId?._id?.toString() || r.playerId?.toString(),
  playerName: r.playerId?.fullName || '',
  playerCode: r.playerId?.playerCode || '',
  parentPhone: r.playerId?.parentPhone || '',
  playerImageUrl: r.playerId?.image_url || null,
});

// ─── GET /renewal-requests?status=pending (سوبر أدمن) ────────────────────────
const listRenewalRequests = async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status)
    ? req.query.status
    : 'pending';

  const requests = await RenewalRequest.find({ status })
    .populate('playerId', 'fullName playerCode parentPhone image_url')
    .populate('academyId', 'name')
    .sort({ created_at: -1 })
    .limit(300);

  return sendSuccess(res, {
    data: requests.map(toAdminJson),
    message: 'تم جلب طلبات التجديد بنجاح',
  });
};

// ─── GET /renewal-requests/pending-count (سوبر أدمن) ─────────────────────────
const getPendingCount = async (req, res) => {
  const count = await RenewalRequest.countDocuments({ status: 'pending' });
  return sendSuccess(res, { data: { count }, message: 'تم جلب العدد بنجاح' });
};

// ─── PATCH /renewal-requests/:id (سوبر أدمن: قبول/رفض) ───────────────────────
const reviewRenewalRequest = async (req, res, next) => {
  const { status } = req.body;
  const request = await RenewalRequest.findById(req.params.id);
  if (!request) return next(new AppError('طلب التجديد غير موجود', 404));
  if (request.status !== 'pending') {
    return next(new AppError('تمت مراجعة هذا الطلب بالفعل', 409));
  }

  request.status = status;
  request.rejectionReason = status === 'rejected' ? String(req.body.rejectionReason || '').trim() : '';
  request.reviewedBy = req.user._id;
  request.reviewedAt = new Date();
  await request.save();

  notify({
    recipientType: 'player',
    recipientId: request.playerId,
    academyId: request.academyId,
    type: 'RENEWAL_REQUEST_REVIEWED',
    title: status === 'approved' ? 'تم قبول طلب التجديد' : 'تم رفض طلب التجديد',
    body:
      status === 'approved'
        ? 'تم تجديد اشتراكك بنجاح.'
        : request.rejectionReason || 'يرجى التواصل مع الأكاديمية.',
    meta: { renewalRequestId: request._id.toString(), status },
  });

  return sendSuccess(res, {
    data: request.toJSON(),
    message: status === 'approved' ? 'تم قبول الطلب' : 'تم رفض الطلب',
  });
};

module.exports = {
  createPlayerRenewalRequest,
  listRenewalRequests,
  getPendingCount,
  reviewRenewalRequest,
};
