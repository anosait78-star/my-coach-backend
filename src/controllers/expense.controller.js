const Expense = require('../models/expense.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { logActivity } = require('../utils/activityLogger');

// ─── GET /expenses ───────────────────────────────────────────────────────────
const getExpenses = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = { academyId: req.user.academyId };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.startDate || req.query.endDate) {
    filter.date = {};
    if (req.query.startDate) filter.date.$gte = req.query.startDate;
    if (req.query.endDate) filter.date.$lte = req.query.endDate;
  }

  const [expenses, total] = await Promise.all([
    Expense.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
    Expense.countDocuments(filter),
  ]);

  return sendPaginated(res, { data: expenses, total, page, limit, message: 'تم جلب المصروفات بنجاح' });
};

// ─── GET /expenses/:id ────────────────────────────────────────────────────────
const getExpenseById = async (req, res, next) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return next(new AppError('المصروف غير موجود', 404));
  if (expense.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى هذا المصروف', 403));
  }
  return sendSuccess(res, { data: expense, message: 'تم جلب بيانات المصروف بنجاح' });
};

// ─── POST /expenses ──────────────────────────────────────────────────────────
const createExpense = async (req, res, next) => {
  const { name, description, amount, date, category } = req.body;

  const expense = await Expense.create({
    academyId: req.user.academyId,
    name,
    description: description !== undefined ? description : null,
    amount,
    date,
    category,
    createdBy: req.user._id,
  });

  logActivity(req, {
    actionType: 'ADD_EXPENSE', entityType: 'EXPENSE',
    entityId: expense._id, entityName: expense.name, academyId: expense.academyId,
  });
  return sendSuccess(res, { data: expense, message: 'تم إضافة المصروف بنجاح', statusCode: 201 });
};

// ─── PUT /expenses/:id ───────────────────────────────────────────────────────
const updateExpense = async (req, res, next) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return next(new AppError('المصروف غير موجود', 404));
  if (expense.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذا المصروف', 403));
  }

  const allowedFields = ['name', 'description', 'amount', 'date', 'category'];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) expense[field] = req.body[field];
  }

  await expense.save();

  logActivity(req, {
    actionType: 'UPDATE_EXPENSE', entityType: 'EXPENSE',
    entityId: expense._id, entityName: expense.name, academyId: expense.academyId,
  });
  return sendSuccess(res, { data: expense, message: 'تم تحديث المصروف بنجاح' });
};

// ─── DELETE /expenses/:id ────────────────────────────────────────────────────
const deleteExpense = async (req, res, next) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return next(new AppError('المصروف غير موجود', 404));
  if (expense.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لحذف هذا المصروف', 403));
  }

  await expense.deleteOne();

  logActivity(req, {
    actionType: 'DELETE_EXPENSE', entityType: 'EXPENSE',
    entityId: expense._id, entityName: expense.name, academyId: expense.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف المصروف بنجاح' });
};

// ─── GET /expenses/report ────────────────────────────────────────────────────
const getExpenseReport = async (req, res, next) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return next(new AppError('تاريخ البداية والنهاية مطلوبان', 400));
  }

  const matchFilter = {
    academyId: req.user.academyId,
    date: { $gte: startDate, $lte: endDate },
  };

  const [byCategory, totals] = await Promise.all([
    Expense.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: matchFilter },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const byCategoryMap = {};
  byCategory.forEach((c) => {
    byCategoryMap[c._id] = { total: c.total, count: c.count };
  });

  return sendSuccess(res, {
    data: {
      totalAmount: totals[0]?.total || 0,
      totalCount: totals[0]?.count || 0,
      byCategory: byCategoryMap,
    },
    message: 'تم جلب تقرير المصروفات بنجاح',
  });
};

module.exports = {
  getExpenses, getExpenseById, createExpense, updateExpense, deleteExpense, getExpenseReport,
};
