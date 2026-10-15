const StaffAttendance = require('../models/staff_attendance.model');
const Staff = require('../models/staff.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');
const {
  resolveAcademyScope,
  resolveAcademyScopeAsObjectId,
  assertAcademyAccess,
} = require('../utils/academyScope');

// ─── POST /staff-attendance ──────────────────────────────────────────────────
const markAttendance = async (req, res, next) => {
  const { staffId, date, status, notes } = req.body;

  const staff = await Staff.findById(staffId);
  if (!staff) return next(new AppError('الموظف غير موجود', 404));
  assertAcademyAccess(req, staff, 'ليس لديك صلاحية لتسجيل حضور هذا الموظف');

  const record = await StaffAttendance.findOneAndUpdate(
    { staffId, date },
    {
      staffId,
      academyId: staff.academyId,
      date,
      status,
      markedBy: req.user._id,
      notes: notes !== undefined ? notes : null,
      // الغياب اليدوي يمسح أوقات المسح إن وُجدت.
      ...(status === 'absent' ? { checkIn: null, checkOut: null } : {}),
    },
    { upsert: true, new: true, runValidators: true }
  );

  logActivity(req, {
    actionType: 'MARK_STAFF_ATTENDANCE', entityType: 'STAFF_ATTENDANCE',
    entityId: record._id, entityName: staff.fullName, academyId: staff.academyId,
  });
  return sendSuccess(res, { data: record, message: 'تم تسجيل الحضور بنجاح' });
};

// ─── POST /staff-attendance/scan ─────────────────────────────────────────────
// الأدمن يمسح QR المدرب: أول مسح في اليوم = حضور، الثاني = انصراف.
// code: "STAFF:<staffId>" أو المعرّف نفسه. localDate/localTime من جهاز الأدمن
// (السيرفر UTC والأكاديمية +2/+3).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const pad2 = (n) => String(n).padStart(2, '0');

const scanAttendance = async (req, res, next) => {
  const raw = String(req.body.code || '').trim();
  const staffId = raw.toUpperCase().startsWith('STAFF:') ? raw.slice(6).trim() : raw;
  if (!/^[a-f\d]{24}$/i.test(staffId)) {
    return next(new AppError('كود المدرب غير صحيح', 400));
  }

  const staff = await Staff.findById(staffId).select('fullName position photo_url academyId isActive');
  if (!staff) return next(new AppError('المدرب غير موجود', 404));
  assertAcademyAccess(req, staff, 'هذا المدرب لا يتبع أكاديميتك');
  if (staff.isActive === false) return next(new AppError('هذا المدرب غير نشط', 400));

  const now = new Date();
  const date = DATE_RE.test(req.body.localDate || '')
    ? req.body.localDate
    : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = TIME_RE.test(req.body.localTime || '')
    ? req.body.localTime
    : `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  let record = await StaffAttendance.findOne({ staffId: staff._id, date });
  let action;
  if (!record || record.status !== 'present' || !record.checkIn) {
    action = 'check_in';
    record = await StaffAttendance.findOneAndUpdate(
      { staffId: staff._id, date },
      {
        staffId: staff._id, academyId: staff.academyId, date, status: 'present',
        checkIn: time, checkOut: null, method: 'scan', markedBy: req.user._id,
      },
      { upsert: true, new: true, runValidators: true }
    );
  } else if (!record.checkOut) {
    action = 'check_out';
    record.checkOut = time;
    record.markedBy = req.user._id;
    await record.save();
  } else {
    return next(new AppError(
      `تم تسجيل حضور (${record.checkIn}) وانصراف (${record.checkOut}) ${staff.fullName} اليوم بالفعل`,
      409
    ));
  }

  logActivity(req, {
    actionType: 'MARK_STAFF_ATTENDANCE', entityType: 'STAFF_ATTENDANCE',
    entityId: record._id, entityName: staff.fullName, academyId: staff.academyId,
  });
  return sendSuccess(res, {
    data: {
      action,
      record,
      staff: {
        _id: staff._id.toString(),
        fullName: staff.fullName,
        position: staff.position,
        photo_url: staff.photo_url || null,
      },
    },
    message: action === 'check_in' ? 'تم تسجيل الحضور' : 'تم تسجيل الانصراف',
  });
};

// ─── GET /staff-attendance ───────────────────────────────────────────────────
const getAttendanceHistory = async (req, res, next) => {
  const filter = { academyId: resolveAcademyScope(req) };

  if (req.query.staffId) filter.staffId = req.query.staffId;

  if (req.query.startDate || req.query.endDate) {
    filter.date = {};
    if (req.query.startDate) filter.date.$gte = req.query.startDate;
    if (req.query.endDate) filter.date.$lte = req.query.endDate;
  }

  const records = await StaffAttendance.find(filter).sort({ date: -1 }).limit(500);
  return sendSuccess(res, { data: records, message: 'تم جلب سجل الحضور بنجاح' });
};

// ─── GET /staff-attendance/report ────────────────────────────────────────────
const getAttendanceReport = async (req, res, next) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return next(new AppError('تاريخ البداية والنهاية مطلوبان', 400));
  }

  // ObjectId وليس نصاً: mongoose لا يصبّ الأنواع داخل $match في aggregate.
  const academyId = resolveAcademyScopeAsObjectId(req);

  const matchFilter = {
    academyId,
    date: { $gte: startDate, $lte: endDate },
  };

  const counts = await StaffAttendance.aggregate([
    { $match: matchFilter },
    { $group: { _id: { staffId: '$staffId', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const staffList = await Staff.find({ academyId, isActive: true })
    .select('fullName position');

  const report = staffList.map((s) => {
    const present = counts.find((c) => c._id.staffId.toString() === s._id.toString() && c._id.status === 'present');
    const absent = counts.find((c) => c._id.staffId.toString() === s._id.toString() && c._id.status === 'absent');
    return {
      staffId: s._id.toString(),
      fullName: s.fullName,
      position: s.position,
      presentCount: present ? present.count : 0,
      absentCount: absent ? absent.count : 0,
    };
  });

  return sendSuccess(res, { data: report, message: 'تم جلب تقرير الحضور بنجاح' });
};

module.exports = { markAttendance, scanAttendance, getAttendanceHistory, getAttendanceReport };
