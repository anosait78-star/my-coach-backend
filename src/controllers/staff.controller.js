const Staff = require('../models/staff.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');
const escapeRegex = require('../utils/escapeRegex');
const { resolveAcademyScope, assertAcademyAccess } = require('../utils/academyScope');

// الحقول المالية في سجل الموظف. تُحجب عن الحسابات الإدارية المحدودة
// (canViewReports=false) قراءةً وكتابةً — إخفاؤها في الواجهة وحدها لا يمنع
// قراءتها من الـ API مباشرةً.
const SALARY_FIELDS = ['baseSalary', 'deductionType', 'deductionValue'];

const canSeeSalary = (req) => req.user.canViewReports !== false;

// إعدادات راتب محايدة للموظف الذي يُنشئه حساب محدود: لا راتب ولا خصم.
// (الحقلان مطلوبان في المخطّط، فلا يمكن تركهما فارغين.) يملؤها لاحقاً حساب
// كامل الصلاحيات من شاشة الموظفين.
const NEUTRAL_SALARY = { deductionType: 'fixed', deductionValue: 0 };

// يحذف الحقول المالية من الاستجابة للحسابات المحدودة.
const present = (req, staff) => {
  if (canSeeSalary(req)) return staff;
  const asJson = (doc) => {
    const obj = typeof doc.toJSON === 'function' ? doc.toJSON() : { ...doc };
    for (const f of SALARY_FIELDS) delete obj[f];
    return obj;
  };
  return Array.isArray(staff) ? staff.map(asJson) : asJson(staff);
};

const parseArrayField = (raw) => {
  if (raw === undefined || raw === null) return undefined;
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
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

// ─── GET /staff ──────────────────────────────────────────────────────────────
const getStaff = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = { academyId: resolveAcademyScope(req) };

  if (req.query.showInactive !== 'true') {
    filter.isActive = true;
  }

  if (req.query.search && req.query.search.trim().length > 0) {
    const regex = new RegExp(escapeRegex(req.query.search.trim()), 'i');
    filter.$or = [{ fullName: regex }, { phone: regex }, { position: regex }];
  }

  const [staff, total] = await Promise.all([
    Staff.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
    Staff.countDocuments(filter),
  ]);

  return sendPaginated(res, { data: present(req, staff), total, page, limit, message: 'تم جلب الموظفين بنجاح' });
};

// ─── GET /staff/:id ──────────────────────────────────────────────────────────
const getStaffById = async (req, res, next) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) return next(new AppError('الموظف غير موجود', 404));
  assertAcademyAccess(req, staff, 'ليس لديك صلاحية للوصول إلى هذا الموظف');
  return sendSuccess(res, { data: present(req, staff), message: 'تم جلب بيانات الموظف بنجاح' });
};

// ─── POST /staff ─────────────────────────────────────────────────────────────
const createStaff = async (req, res, next) => {
  const {
    fullName, position, phone, email, hireDate, baseSalary,
    monthlyAttendanceTarget, deductionType, deductionValue,
  } = req.body;

  const staffData = {
    academyId: resolveAcademyScope(req),
    fullName,
    position,
    phone,
    hireDate,
    monthlyAttendanceTarget,
    deductionType,
    deductionValue,
  };

  if (email !== undefined && email !== '') staffData.email = email;

  if (canSeeSalary(req)) {
    if (baseSalary !== undefined && baseSalary !== '') staffData.baseSalary = baseSalary;
  } else {
    // نتجاهل أي قيم مالية مُرسَلة ونثبّت إعدادات محايدة.
    Object.assign(staffData, NEUTRAL_SALARY);
  }

  const workingDays = parseArrayField(req.body.workingDays);
  if (workingDays !== undefined) staffData.workingDays = workingDays;

  if (req.file) {
    staffData.photo_url = req.file.path;
    staffData.photo_public_id = req.file.filename;
  }

  const staff = await Staff.create(staffData);

  logger.info(`Staff created: ${staff.fullName}`);
  logActivity(req, {
    actionType: 'ADD_STAFF', entityType: 'STAFF',
    entityId: staff._id, entityName: staff.fullName, academyId: staff.academyId,
  });
  return sendSuccess(res, { data: present(req, staff), message: 'تم إضافة الموظف بنجاح', statusCode: 201 });
};

// ─── PUT /staff/:id ──────────────────────────────────────────────────────────
const updateStaff = async (req, res, next) => {
  const staff = await Staff.findById(req.params.id).select('+photo_public_id');
  if (!staff) return next(new AppError('الموظف غير موجود', 404));
  assertAcademyAccess(req, staff, 'ليس لديك صلاحية لتعديل هذا الموظف');

  const allowedFields = [
    'fullName', 'position', 'phone', 'email', 'hireDate',
    'monthlyAttendanceTarget',
    // الحقول المالية تُضاف فقط لمن يملك صلاحيتها؛ غيره لا يمسّ القيم القائمة.
    ...(canSeeSalary(req) ? SALARY_FIELDS : []),
  ];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) staff[field] = req.body[field];
  }

  const workingDays = parseArrayField(req.body.workingDays);
  if (workingDays !== undefined) staff.workingDays = workingDays;

  if (req.file) {
    if (staff.photo_public_id) {
      await deleteImage(staff.photo_public_id).catch(() => {});
    }
    staff.photo_url = req.file.path;
    staff.photo_public_id = req.file.filename;
  }

  await staff.save();

  logger.info(`Staff updated: ${staff.fullName}`);
  logActivity(req, {
    actionType: 'UPDATE_STAFF', entityType: 'STAFF',
    entityId: staff._id, entityName: staff.fullName, academyId: staff.academyId,
  });
  return sendSuccess(res, { data: present(req, staff), message: 'تم تحديث بيانات الموظف بنجاح' });
};

// ─── DELETE /staff/:id ───────────────────────────────────────────────────────
const deleteStaff = async (req, res, next) => {
  const staff = await Staff.findById(req.params.id);
  if (!staff) return next(new AppError('الموظف غير موجود', 404));
  assertAcademyAccess(req, staff, 'ليس لديك صلاحية لحذف هذا الموظف');

  staff.isActive = false;
  await staff.save();

  logger.info(`Staff deleted (soft): ${staff.fullName}`);
  logActivity(req, {
    actionType: 'DELETE_STAFF', entityType: 'STAFF',
    entityId: staff._id, entityName: staff.fullName, academyId: staff.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف الموظف بنجاح' });
};

module.exports = { getStaff, getStaffById, createStaff, updateStaff, deleteStaff };
