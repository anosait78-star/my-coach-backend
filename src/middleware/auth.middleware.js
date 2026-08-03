const AppError = require('../utils/AppError');
const { verifyToken } = require('../utils/jwt');
const User = require('../models/user.model');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(new AppError('يجب تسجيل الدخول للوصول إلى هذا المورد', 401));
  }

  try {
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) return next(new AppError('المستخدم غير موجود', 401));
    if (!user.isActive) return next(new AppError('تم تعطيل هذا الحساب', 401));

    req.user = user;
    next();
  } catch (error) {
    return next(new AppError('رمز التحقق غير صحيح أو منتهي الصلاحية', 401));
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new AppError('ليس لديك صلاحية لتنفيذ هذا الإجراء', 403));
    }
    next();
  };
};

module.exports = { protect, restrictTo };
