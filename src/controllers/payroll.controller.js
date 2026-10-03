const Payroll = require('../models/payroll.model');
const Staff = require('../models/staff.model');
const StaffAttendance = require('../models/staff_attendance.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');
const { resolveAcademyScope, assertAcademyAccess } = require('../utils/academyScope');

const WEEKDAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// أيام العمل المتوقعة للموظف في الشهر (حسب workingDays) — للعرض فقط (الغياب).
const expectedWorkingDays = (workingDays, year, mon) => {
  const days = Array.isArray(workingDays) ? workingDays : [];
  const last = new Date(year, mon, 0).getDate();
  let count = 0;
  for (let d = 1; d <= last; d++) {
    if (days.includes(WEEKDAY_AR[new Date(year, mon - 1, d).getDay()])) count += 1;
  }
  return count;
};

// المرتب = سعر التمرينة × أيام الحضور المسجّلة في الشهر. لا خصم: يوم الغياب
// ببساطة لا يُدفع. absentCount للعرض فقط (أيام العمل المتوقعة − الحضور).
const computeSessionSalary = ({ sessionRate, presentCount, expectedDays }) => {
  const rate = sessionRate || 0;
  const salary = rate * presentCount;
  return {
    absentCount: Math.max(expectedDays - presentCount, 0),
    deductionAmount: 0,
    baseSalary: salary,
    netSalary: salary,
  };
};

// ─── POST /payroll/generate ──────────────────────────────────────────────────
const generatePayroll = async (req, res, next) => {
  const { month, staffId, force } = req.body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return next(new AppError('الشهر مطلوب بصيغة YYYY-MM', 400));
  }

  const staffFilter = { academyId: resolveAcademyScope(req), isActive: true };
  if (staffId) staffFilter._id = staffId;

  const staffList = await Staff.find(staffFilter);
  if (staffList.length === 0) {
    return next(new AppError('لا يوجد موظفون لتوليد الرواتب لهم', 404));
  }

  const startDate = `${month}-01`;
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

  const results = [];
  for (const staff of staffList) {
    const existing = await Payroll.findOne({ staffId: staff._id, month });
    if (existing && existing.status === 'paid' && !force) {
      results.push(existing);
      continue;
    }

    const presentCount = await StaffAttendance.countDocuments({
      staffId: staff._id,
      status: 'present',
      date: { $gte: startDate, $lte: endDate },
    });

    const { absentCount, deductionAmount, baseSalary, netSalary } = computeSessionSalary({
      sessionRate: staff.sessionRate,
      presentCount,
      expectedDays: expectedWorkingDays(staff.workingDays, year, mon),
    });

    const payrollDoc = await Payroll.findOneAndUpdate(
      { staffId: staff._id, month },
      {
        academyId: staff.academyId,
        staffId: staff._id,
        month,
        baseSalary,
        sessionRate: staff.sessionRate || 0,
        presentCount,
        absentCount,
        deductionType: 'fixed',
        deductionValue: 0,
        deductionAmount,
        netSalary,
        generatedAt: new Date(),
      },
      { upsert: true, new: true, runValidators: true }
    );

    logActivity(req, {
      actionType: 'GENERATE_PAYROLL', entityType: 'PAYROLL',
      entityId: payrollDoc._id, entityName: staff.fullName, academyId: staff.academyId,
    });
    results.push(payrollDoc);
  }

  return sendSuccess(res, { data: results, message: 'تم توليد الرواتب بنجاح' });
};

// ─── GET /payroll ────────────────────────────────────────────────────────────
const getPayrollList = async (req, res, next) => {
  const filter = { academyId: resolveAcademyScope(req) };
  if (req.query.month) filter.month = req.query.month;
  if (req.query.staffId) filter.staffId = req.query.staffId;
  if (req.query.status) filter.status = req.query.status;

  const records = await Payroll.find(filter).populate('staffId', 'fullName position').sort({ month: -1 });
  return sendSuccess(res, { data: records, message: 'تم جلب الرواتب بنجاح' });
};

// ─── GET /payroll/report ─────────────────────────────────────────────────────
const getPayrollReport = async (req, res, next) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return next(new AppError('الشهر مطلوب بصيغة YYYY-MM', 400));
  }

  const records = await Payroll.find({ academyId: resolveAcademyScope(req), month })
    .populate('staffId', 'fullName position');

  const report = records.map((r) => ({
    staffId: r.staffId?._id?.toString(),
    fullName: r.staffId?.fullName,
    position: r.staffId?.position,
    baseSalary: r.baseSalary,
    deductionAmount: r.deductionAmount,
    netSalary: r.netSalary,
    status: r.status,
  }));

  const totals = report.reduce(
    (acc, r) => ({
      totalBaseSalary: acc.totalBaseSalary + r.baseSalary,
      totalDeductions: acc.totalDeductions + r.deductionAmount,
      totalNetSalary: acc.totalNetSalary + r.netSalary,
    }),
    { totalBaseSalary: 0, totalDeductions: 0, totalNetSalary: 0 }
  );

  return sendSuccess(res, { data: { report, totals }, message: 'تم جلب تقرير الرواتب بنجاح' });
};

// ─── PATCH /payroll/:id/mark-paid ────────────────────────────────────────────
const markPaid = async (req, res, next) => {
  const payroll = await Payroll.findById(req.params.id);
  if (!payroll) return next(new AppError('سجل الراتب غير موجود', 404));
  assertAcademyAccess(req, payroll, 'ليس لديك صلاحية لتعديل هذا السجل');

  payroll.status = 'paid';
  payroll.paidAt = new Date();
  await payroll.save();

  logActivity(req, {
    actionType: 'MARK_PAYROLL_PAID', entityType: 'PAYROLL',
    entityId: payroll._id, entityName: payroll.month, academyId: payroll.academyId,
  });
  return sendSuccess(res, { data: payroll, message: 'تم تأكيد دفع الراتب بنجاح' });
};

module.exports = { generatePayroll, getPayrollList, getPayrollReport, markPaid };
