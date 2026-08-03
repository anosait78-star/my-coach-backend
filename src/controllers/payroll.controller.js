const Payroll = require('../models/payroll.model');
const Staff = require('../models/staff.model');
const StaffAttendance = require('../models/staff_attendance.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

const computeNetSalary = ({ baseSalary, monthlyAttendanceTarget, presentCount, deductionType, deductionValue }) => {
  const absentCount = Math.max(monthlyAttendanceTarget - presentCount, 0);
  const salary = baseSalary || 0;
  let deductionAmount;
  if (deductionType === 'percentage') {
    deductionAmount = salary * (deductionValue / 100) * absentCount;
  } else {
    deductionAmount = deductionValue * absentCount;
  }
  deductionAmount = Math.min(deductionAmount, salary);
  const netSalary = salary - deductionAmount;
  return { absentCount, deductionAmount, netSalary };
};

// ─── POST /payroll/generate ──────────────────────────────────────────────────
const generatePayroll = async (req, res, next) => {
  const { month, staffId, force } = req.body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return next(new AppError('الشهر مطلوب بصيغة YYYY-MM', 400));
  }

  const staffFilter = { academyId: req.user.academyId, isActive: true };
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

    const { absentCount, deductionAmount, netSalary } = computeNetSalary({
      baseSalary: staff.baseSalary,
      monthlyAttendanceTarget: staff.monthlyAttendanceTarget,
      presentCount,
      deductionType: staff.deductionType,
      deductionValue: staff.deductionValue,
    });

    const payrollDoc = await Payroll.findOneAndUpdate(
      { staffId: staff._id, month },
      {
        academyId: staff.academyId,
        staffId: staff._id,
        month,
        baseSalary: staff.baseSalary || 0,
        monthlyAttendanceTarget: staff.monthlyAttendanceTarget,
        presentCount,
        absentCount,
        deductionType: staff.deductionType,
        deductionValue: staff.deductionValue,
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
  const filter = { academyId: req.user.academyId };
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

  const records = await Payroll.find({ academyId: req.user.academyId, month })
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
  if (payroll.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذا السجل', 403));
  }

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
