const { validationResult } = require('express-validator');
const AppError = require('../utils/AppError');
const { deleteImage } = require('../config/cloudinary');

// مثل middleware/validate، لكن للمسارات التي ترفع ملفاً إلى Cloudinary قبل
// التحقّق. multer ينهي الرفع قبل أن تصل الطلبات إلى المدقّق، فرفض الطلب هنا
// بلا حذف يترك صوراً يتيمة في الحساب. نحذف كل ما رُفع في هذا الطلب أولاً.
const validateUpload = async (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const uploaded = [
    req.file,
    ...Object.values(req.files || {}).flat(),
  ].filter(Boolean);

  for (const file of uploaded) {
    if (file.filename) await deleteImage(file.filename).catch(() => {});
  }

  const messages = errors.array().map((e) => e.msg).join(', ');
  return next(new AppError(messages, 422));
};

module.exports = validateUpload;
