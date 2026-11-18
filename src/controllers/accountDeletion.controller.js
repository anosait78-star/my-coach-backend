const AccountDeletionRequest = require('../models/accountDeletionRequest.model');
const logger = require('../utils/logger');
const {
  renderDeletionPage,
  renderDeletionSuccess,
  validateDeletionForm,
} = require('../utils/accountDeletionPage');

// GET /delete-account — صفحة عامة (رابط حذف الحساب في Google Play).
const showDeletionPage = (req, res) => {
  res.status(200).type('html').send(renderDeletionPage());
};

// POST /delete-account — استقبال نموذج الطلب من الصفحة العامة.
const submitDeletionRequest = async (req, res) => {
  const { data, errors, isSpam } = validateDeletionForm(req.body);

  // روبوت ملأ حقل الفخّ: نعرض صفحة النجاح دون حفظ حتى لا نكشف الفلترة.
  if (isSpam) return res.status(200).type('html').send(renderDeletionSuccess());

  if (errors.length) {
    return res.status(400).type('html').send(renderDeletionPage({ values: data, errors }));
  }

  const request = await AccountDeletionRequest.create(data);
  logger.info(`Account deletion request received: ${request._id}`);
  return res.status(201).type('html').send(renderDeletionSuccess());
};

// GET /api/v1/account-deletion-requests — للسوبر أدمن.
const listDeletionRequests = async (req, res) => {
  const filter = {};
  if (['pending', 'completed', 'rejected'].includes(req.query.status)) {
    filter.status = req.query.status;
  }
  const requests = await AccountDeletionRequest.find(filter).sort({ created_at: -1 }).limit(200);
  res.status(200).json({ success: true, data: requests });
};

// PATCH /api/v1/account-deletion-requests/:id — تحديث الحالة بعد المعالجة اليدوية.
const updateDeletionRequest = async (req, res) => {
  const request = await AccountDeletionRequest.findById(req.params.id);
  if (!request) {
    return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
  }
  request.status = req.body.status;
  if (typeof req.body.adminNote === 'string') request.adminNote = req.body.adminNote;
  request.handledBy = req.user._id;
  request.handledAt = new Date();
  await request.save();
  res.status(200).json({ success: true, data: request });
};

module.exports = {
  showDeletionPage,
  submitDeletionRequest,
  listDeletionRequests,
  updateDeletionRequest,
};
