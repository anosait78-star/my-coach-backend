const User = require('../models/user.model');
const Academy = require('../models/academy.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');

/**
 * POST /api/v1/users
 * super_admin only — creates academy_admin or admin users
 */
const createUser = async (req, res, next) => {
  const { name, email, password, academyId, role: requestedRole } = req.body;

  // Verify the target academy exists and is active
  const academy = await Academy.findById(academyId);
  if (!academy) {
    return next(new AppError('الأكاديمية المحددة غير موجودة', 404));
  }
  if (!academy.isActive) {
    return next(new AppError('لا يمكن إضافة مستخدم إلى أكاديمية غير نشطة', 400));
  }

  // Prevent duplicate emails
  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    return next(new AppError('البريد الإلكتروني مستخدم بالفعل', 409));
  }

  // super_admin can create academy_admin or admin; default to academy_admin
  const allowedRoles = ['academy_admin', 'admin'];
  const newRole = allowedRoles.includes(requestedRole) ? requestedRole : 'academy_admin';
  logger.info(`createUser — requestedRole="${requestedRole}" → newRole="${newRole}"`);

  const user = await User.create({
    name,
    email,
    password,
    role: newRole,
    academyId,
  });

  logger.info(`User created: ${user.email} for academy ${academy.name} by ${req.user.email}`);
  logActivity(req, {
    actionType: 'ADD_USER', entityType: 'USER',
    entityId: user._id, entityName: user.name, academyId,
  });

  // Populate academyId before returning so the response includes academy details
  await user.populate('academyId', 'name');

  return sendSuccess(res, {
    data: user,
    message: 'تم إنشاء المستخدم بنجاح',
    statusCode: 201,
  });
};

/**
 * PUT /api/v1/users/:id
 * super_admin only — updates name and/or email
 */
const updateUser = async (req, res, next) => {
  const { name, email } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new AppError('المستخدم غير موجود', 404));
  }

  // Prevent changing email to one already taken by another user
  if (email && email.toLowerCase().trim() !== user.email) {
    const duplicate = await User.findOne({ email: email.toLowerCase().trim() });
    if (duplicate) {
      return next(new AppError('البريد الإلكتروني مستخدم بالفعل', 409));
    }
    user.email = email;
  }

  if (name) user.name = name;

  await user.save();
  await user.populate('academyId', 'name');

  logger.info(`User updated: ${user.email} by ${req.user.email}`);
  logActivity(req, {
    actionType: 'UPDATE_USER', entityType: 'USER',
    entityId: user._id, entityName: user.name, academyId: user.academyId,
  });

  return sendSuccess(res, {
    data: user,
    message: 'تم تحديث المستخدم بنجاح',
  });
};

/**
 * PATCH /api/v1/users/:id/reset-password
 * super_admin only — sets a new password for any user.
 * Uses the same bcrypt hashing via the user model pre-save hook.
 */
const resetUserPassword = async (req, res, next) => {
  const { newPassword } = req.body;

  // select +password so the pre-save hook re-hashes correctly
  const user = await User.findById(req.params.id).select('+password');
  if (!user) {
    return next(new AppError('المستخدم غير موجود', 404));
  }

  user.password = newPassword;
  await user.save();

  logger.info(`Password reset for user: ${user.email} by ${req.user.email}`);

  return sendSuccess(res, { message: 'تم تغيير كلمة مرور المستخدم بنجاح' });
};

/**
 * DELETE /api/v1/users/:id
 * super_admin only — soft delete (isActive = false)
 */
const deleteUser = async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new AppError('المستخدم غير موجود', 404));
  }

  // Protect super_admin accounts from accidental deletion via this endpoint
  if (user.role === 'super_admin') {
    return next(new AppError('لا يمكن حذف حساب المدير العام', 403));
  }

  if (!user.isActive) {
    return next(new AppError('المستخدم محذوف بالفعل', 400));
  }

  user.isActive = false;
  await user.save();

  logger.info(`User soft-deleted: ${user.email} by ${req.user.email}`);
  logActivity(req, {
    actionType: 'DELETE_USER', entityType: 'USER',
    entityId: user._id, entityName: user.name, academyId: user.academyId,
  });

  return sendSuccess(res, { message: 'تم حذف المستخدم بنجاح' });
};

/**
 * PATCH /api/v1/users/:id/activate
 * super_admin only — sets isActive = true
 */
const activateUser = async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new AppError('المستخدم غير موجود', 404));
  }

  if (user.isActive) {
    return next(new AppError('المستخدم نشط بالفعل', 400));
  }

  user.isActive = true;
  await user.save();
  await user.populate('academyId', 'name');

  logger.info(`User activated: ${user.email} by ${req.user.email}`);

  return sendSuccess(res, {
    data: user,
    message: 'تم تفعيل المستخدم بنجاح',
  });
};

/**
 * PATCH /api/v1/users/:id/deactivate
 * super_admin only — sets isActive = false
 */
const deactivateUser = async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    return next(new AppError('المستخدم غير موجود', 404));
  }

  if (user.role === 'super_admin') {
    return next(new AppError('لا يمكن تعطيل حساب المدير العام', 403));
  }

  if (!user.isActive) {
    return next(new AppError('المستخدم معطل بالفعل', 400));
  }

  user.isActive = false;
  await user.save();
  await user.populate('academyId', 'name');

  logger.info(`User deactivated: ${user.email} by ${req.user.email}`);

  return sendSuccess(res, {
    data: user,
    message: 'تم تعطيل المستخدم بنجاح',
  });
};

/**
 * GET /api/v1/users/academy/:academyId
 * super_admin — any academy; academy_admin — own academy only
 */
const getUsersByAcademy = async (req, res, next) => {
  const { academyId } = req.params;

  // academy_admin and admin may only query their own academy
  if (
    (req.user.role === 'academy_admin' || req.user.role === 'admin') &&
    req.user.academyId?.toString() !== academyId
  ) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى مستخدمي هذه الأكاديمية', 403));
  }

  // Confirm the academy exists
  const academy = await Academy.findById(academyId);
  if (!academy) {
    return next(new AppError('الأكاديمية غير موجودة', 404));
  }

  const users = await User.find({ academyId })
    .populate('academyId', 'name')
    .sort({ created_at: -1 });

  return sendSuccess(res, {
    data: users,
    message: 'تم جلب المستخدمين بنجاح',
  });
};

/**
 * GET /api/v1/users/:id
 * protect — any authenticated user can fetch a single user record;
 * academy_admin is restricted to users within their own academy.
 */
const getUserById = async (req, res, next) => {
  const user = await User.findById(req.params.id).populate('academyId', 'name');
  if (!user) {
    return next(new AppError('المستخدم غير موجود', 404));
  }

  // academy_admin and admin can only see users from their own academy
  if (
    (req.user.role === 'academy_admin' || req.user.role === 'admin') &&
    user.academyId?._id?.toString() !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى هذا المستخدم', 403));
  }

  return sendSuccess(res, { data: user });
};

module.exports = {
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
  activateUser,
  deactivateUser,
  getUsersByAcademy,
  getUserById,
};
