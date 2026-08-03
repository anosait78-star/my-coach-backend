const AppError = require('../utils/AppError');

const notFound = (req, res, next) => {
  next(new AppError(`المسار ${req.originalUrl} غير موجود`, 404));
};

module.exports = notFound;
