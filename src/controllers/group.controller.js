const Group = require('../models/group.model');
const Player = require('../models/player.model');
const Academy = require('../models/academy.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');

// ─── Helpers ─────────────────────────────────────────────────────────────────

// يحدّد فلتر الأكاديمية حسب الدور: super_admin وحده يمرّر academyId صراحةً،
// وكل من عداه (academy_admin / admin) مُقيَّد حتمياً بأكاديميته — نفس نمط اللاعبين/التقييمات.
const resolveAcademyFilter = (req) => {
  if (req.user.role === 'super_admin') {
    if (!req.query.academyId) {
      throw new AppError('معرّف الأكاديمية مطلوب', 400);
    }
    return req.query.academyId;
  }
  return req.user.academyId;
};

// حارس وصول: يمنع الوصول لمجموعة تخصّ أكاديمية أخرى. super_admin وحده يتجاوز القيد.
const assertAccess = (req, group) => {
  if (
    req.user.role !== 'super_admin' &&
    group.academyId.toString() !== req.user.academyId?.toString()
  ) {
    throw new AppError('ليس لديك صلاحية للوصول إلى هذه المجموعة', 403);
  }
};

// يُرفق playersCount / occupationRate المحسوبتين وقت القراءة (لا تُخزَّنان في الوثيقة).
const withOccupancy = async (groups) => {
  const list = Array.isArray(groups) ? groups : [groups];
  if (list.length === 0) return groups;

  const groupIds = list.map((g) => g._id);
  const counts = await Player.aggregate([
    { $match: { groupId: { $in: groupIds }, isActive: true } },
    { $group: { _id: '$groupId', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

  const attach = (g) => {
    const obj = g.toJSON ? g.toJSON() : g;
    const playersCount = countMap.get(obj._id.toString()) || 0;
    obj.playersCount = playersCount;
    obj.occupationRate = obj.capacity ? Math.round((playersCount / obj.capacity) * 100) : null;
    return obj;
  };

  const result = list.map(attach);
  return Array.isArray(groups) ? result : result[0];
};

// ─── GET /groups ─────────────────────────────────────────────────────────────
const getGroups = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const academyId = resolveAcademyFilter(req);
  const filter = { academyId };
  // بحث بالاسم (اختياري).
  if (req.query.search && req.query.search.trim().length > 0) {
    filter.name = { $regex: req.query.search.trim(), $options: 'i' };
  }

  const [groups, total] = await Promise.all([
    Group.find(filter).sort({ order: 1, created_at: -1 }).skip(skip).limit(limit),
    Group.countDocuments(filter),
  ]);

  const data = await withOccupancy(groups);

  return sendPaginated(res, { data, total, page, limit, message: 'تم جلب المجموعات بنجاح' });
};

// ─── GET /groups/academy/:academyId ──────────────────────────────────────────
const getGroupsByAcademy = async (req, res, next) => {
  const { academyId } = req.params;
  if (
    req.user.role !== 'super_admin' &&
    academyId !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى مجموعات هذه الأكاديمية', 403));
  }

  const filter = { academyId };

  const groups = await Group.find(filter).sort({ order: 1, name: 1 });
  const data = await withOccupancy(groups);

  return sendSuccess(res, { data, message: 'تم جلب المجموعات بنجاح' });
};

// ─── GET /groups/:id ──────────────────────────────────────────────────────────
const getGroupById = async (req, res, next) => {
  const group = await Group.findById(req.params.id);
  if (!group) return next(new AppError('المجموعة غير موجودة', 404));

  assertAccess(req, group);

  const [withCount] = await withOccupancy([group]);
  const players = await Player.find({ groupId: group._id, isActive: true }).sort({ fullName: 1 });

  return sendSuccess(res, {
    data: { ...withCount, players },
    message: 'تم جلب بيانات المجموعة بنجاح',
  });
};

// ─── POST /groups ─────────────────────────────────────────────────────────────
const createGroup = async (req, res, next) => {
  let academyId;
  if (req.user.role === 'super_admin') {
    academyId = req.body.academyId;
    if (!academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  } else {
    academyId = req.user.academyId;
  }

  const academy = await Academy.findById(academyId).select('_id');
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));

  // المجموعة تقسيم تنظيمي داخل الأكاديمية فقط — لا علاقة لها بالرياضة.
  const groupData = {
    academyId,
    name: req.body.name,
  };

  if (req.body.capacity !== undefined) groupData.capacity = req.body.capacity;
  if (req.body.isActive !== undefined) groupData.isActive = req.body.isActive;
  // المجموعة الجديدة تُلحق في نهاية ترتيب الأكاديمية.
  groupData.order = await Group.countDocuments({ academyId });
  const group = await Group.create(groupData);

  logger.info(`Group created: ${group.name}`);
  logActivity(req, {
    actionType: 'CREATE_GROUP', entityType: 'GROUP',
    entityId: group._id, entityName: group.name, academyId: group.academyId,
  });

  return res.status(201).json({ success: true, message: 'تم إنشاء المجموعة بنجاح', data: group });
};

// ─── PATCH /groups/:id ────────────────────────────────────────────────────────
const updateGroup = async (req, res, next) => {
  const group = await Group.findById(req.params.id);
  if (!group) return next(new AppError('المجموعة غير موجودة', 404));

  assertAccess(req, group);

  const allowedFields = ['name', 'capacity', 'isActive'];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      group[field] = req.body[field] === '' ? null : req.body[field];
    }
  }

  await group.save();

  logger.info(`Group updated: ${group.name}`);
  logActivity(req, {
    actionType: 'UPDATE_GROUP', entityType: 'GROUP',
    entityId: group._id, entityName: group.name, academyId: group.academyId,
  });

  return sendSuccess(res, { data: group, message: 'تم تحديث بيانات المجموعة بنجاح' });
};

// ─── DELETE /groups/:id ───────────────────────────────────────────────────────
const deleteGroup = async (req, res, next) => {
  const group = await Group.findById(req.params.id);
  if (!group) return next(new AppError('المجموعة غير موجودة', 404));

  assertAccess(req, group);

  // منع حذف مجموعة تحتوي لاعبين نشطين — لتفادي اللاعبين اليتامى.
  const playersCount = await Player.countDocuments({ groupId: group._id, isActive: true });
  if (playersCount > 0) {
    return res.status(409).json({
      success: false,
      code: 'GROUP_NOT_EMPTY',
      message: 'لا يمكن حذف المجموعة لأنها تحتوي على لاعبين. قم بنقل اللاعبين أولاً.',
    });
  }

  await group.deleteOne();

  logger.info(`Group deleted: ${group.name}`);
  logActivity(req, {
    actionType: 'DELETE_GROUP', entityType: 'GROUP',
    entityId: group._id, entityName: group.name, academyId: group.academyId,
  });

  return sendSuccess(res, { message: 'تم حذف المجموعة بنجاح' });
};

// ─── PATCH /groups/reorder ────────────────────────────────────────────────────
// يحدّث حقل order فقط وفق ترتيب المعرّفات المُرسَل. مُقيَّد بأكاديمية المستخدم.
const reorderGroups = async (req, res, next) => {
  const scopeId = req.user.role === 'super_admin'
    ? (req.body.academyId || req.query.academyId)
    : req.user.academyId;
  if (!scopeId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));

  const ids = Array.isArray(req.body.orderedIds) ? req.body.orderedIds : [];
  if (ids.length === 0) return next(new AppError('قائمة الترتيب مطلوبة', 422));

  // تأكيد أن كل المجموعات تخصّ هذه الأكاديمية (حارس عزل).
  const owned = await Group.find({ _id: { $in: ids } }).select('academyId');
  const allOwned = owned.length === ids.length &&
    owned.every((g) => g.academyId.toString() === scopeId.toString());
  if (!allOwned) {
    return next(new AppError('ليس لديك صلاحية لإعادة ترتيب هذه المجموعات', 403));
  }

  const ops = ids.map((id, index) => ({
    updateOne: {
      filter: { _id: id, academyId: scopeId },
      update: { $set: { order: index } },
    },
  }));
  await Group.bulkWrite(ops);

  return sendSuccess(res, { message: 'تم تحديث ترتيب المجموعات بنجاح' });
};

// ─── PATCH /groups/:id/move-players ───────────────────────────────────────────
// ينقل عدة لاعبين إلى مجموعة الوجهة. تحقق أكاديمية فقط — لا تحقق رياضة.
const movePlayers = async (req, res, next) => {
  const targetGroup = await Group.findById(req.params.id);
  if (!targetGroup) return next(new AppError('المجموعة غير موجودة', 404));

  assertAccess(req, targetGroup);

  const playerIds = Array.isArray(req.body.playerIds) ? req.body.playerIds : [];
  if (playerIds.length === 0) return next(new AppError('قائمة اللاعبين مطلوبة', 422));

  // عزل: كل اللاعبين يجب أن يكونوا ضمن نفس أكاديمية المجموعة.
  const result = await Player.updateMany(
    { _id: { $in: playerIds }, academyId: targetGroup.academyId },
    { $set: { groupId: targetGroup._id } }
  );

  logger.info(`Moved ${result.modifiedCount} players to group: ${targetGroup.name}`);
  logActivity(req, {
    actionType: 'PLAYER_MOVED_BETWEEN_GROUPS', entityType: 'GROUP',
    entityId: targetGroup._id, entityName: targetGroup.name, academyId: targetGroup.academyId,
  });

  return sendSuccess(res, {
    data: { movedCount: result.modifiedCount },
    message: 'تم نقل اللاعبين بنجاح',
  });
};

module.exports = {
  getGroups,
  getGroupsByAcademy,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  reorderGroups,
  movePlayers,
};
