const mongoose = require('mongoose');
const Family = require('../models/family.model');
const PlayerAccount = require('../models/playerAccount.model');
const Player = require('../models/player.model');
const Academy = require('../models/academy.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');

// شكل موحّد لحساب عضو/مرشّح يقرأه الفرونت مباشرة.
const memberJson = (account, academyNames) => {
  const p = account.playerId;
  const academyId = account.academyId?.toString();
  return {
    accountId: account._id.toString(),
    username: account.username,
    isActive: account.isActive,
    familyId: account.familyId ? account.familyId.toString() : null,
    playerId: p?._id?.toString() || null,
    fullName: p?.fullName || '',
    playerCode: p?.playerCode || '',
    image_url: p?.image_url || null,
    academyId,
    academyName: academyNames.get(academyId) || '',
  };
};

const academyNameMap = async (accounts) => {
  const ids = [...new Set(accounts.map((a) => a.academyId?.toString()).filter(Boolean))];
  const academies = await Academy.find({ _id: { $in: ids } }).select('name');
  return new Map(academies.map((a) => [a._id.toString(), a.name]));
};

const parseIds = (raw) =>
  [...new Set((Array.isArray(raw) ? raw : []).map(String))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );

// يتحقق أن كل الحسابات موجودة وليست في عائلة أخرى غير [allowFamilyId].
const loadFreeAccounts = async (ids, allowFamilyId = null) => {
  const accounts = await PlayerAccount.find({ _id: { $in: ids } });
  if (accounts.length !== ids.length) {
    throw new AppError('بعض الحسابات المختارة غير موجودة', 404);
  }
  const taken = accounts.filter(
    (a) => a.familyId && a.familyId.toString() !== allowFamilyId?.toString()
  );
  if (taken.length) {
    throw new AppError(`الحساب ${taken[0].username} ضمن عائلة أخرى بالفعل`, 409);
  }
  return accounts;
};

const familyJson = async (family) => {
  const members = await PlayerAccount.find({ familyId: family._id })
    .populate('playerId', 'fullName playerCode image_url')
    .sort({ created_at: 1 });
  const names = await academyNameMap(members);
  return {
    _id: family._id.toString(),
    name: family.name || '',
    created_at: family.created_at,
    members: members.map((m) => memberJson(m, names)),
  };
};

// ─── GET /families ───────────────────────────────────────────────────────────
const listFamilies = async (req, res) => {
  const families = await Family.find().sort({ created_at: -1 }).limit(500);
  const data = await Promise.all(families.map(familyJson));
  return sendSuccess(res, { data, message: 'تم جلب العائلات بنجاح' });
};

// ─── GET /families/candidates?search= ────────────────────────────────────────
// حسابات لاعبين من كل الفروع، بالبحث في الاسم/الكود/هاتف ولي الأمر/اسم المستخدم.
const searchCandidates = async (req, res) => {
  const term = String(req.query.search || '').trim();
  if (term.length < 2) {
    return sendSuccess(res, { data: [], message: 'اكتب حرفين على الأقل للبحث' });
  }
  const regex = new RegExp(escapeRegex(term), 'i');
  const players = await Player.find({
    $or: [{ fullName: regex }, { playerCode: regex }, { parentPhone: regex }],
  })
    .select('_id')
    .limit(100);

  const accounts = await PlayerAccount.find({
    $or: [{ playerId: { $in: players.map((p) => p._id) } }, { username: regex }],
  })
    .populate('playerId', 'fullName playerCode image_url')
    .limit(50);

  const names = await academyNameMap(accounts);
  return sendSuccess(res, {
    data: accounts.filter((a) => a.playerId).map((a) => memberJson(a, names)),
    message: 'تم البحث بنجاح',
  });
};

// ─── POST /families  { name?, accountIds[] (2+) } ────────────────────────────
const createFamily = async (req, res, next) => {
  const ids = parseIds(req.body.accountIds);
  if (ids.length < 2) return next(new AppError('اختر حسابين على الأقل', 400));

  const accounts = await loadFreeAccounts(ids);
  const family = await Family.create({
    name: String(req.body.name || '').trim(),
    createdBy: req.user._id,
  });
  await PlayerAccount.updateMany(
    { _id: { $in: accounts.map((a) => a._id) } },
    { $set: { familyId: family._id } }
  );

  logger.info(`Family ${family._id} created with ${ids.length} accounts by ${req.user._id}`);
  return sendSuccess(res, {
    data: await familyJson(family),
    message: 'تم دمج الحسابات في عائلة',
    statusCode: 201,
  });
};

// ─── PATCH /families/:id  { name } ───────────────────────────────────────────
const renameFamily = async (req, res, next) => {
  const family = await Family.findById(req.params.id);
  if (!family) return next(new AppError('العائلة غير موجودة', 404));
  family.name = String(req.body.name || '').trim();
  await family.save();
  return sendSuccess(res, { data: await familyJson(family), message: 'تم تعديل اسم العائلة' });
};

// ─── POST /families/:id/members  { accountIds[] } ────────────────────────────
const addMembers = async (req, res, next) => {
  const family = await Family.findById(req.params.id);
  if (!family) return next(new AppError('العائلة غير موجودة', 404));
  const ids = parseIds(req.body.accountIds);
  if (!ids.length) return next(new AppError('اختر حساباً واحداً على الأقل', 400));

  await loadFreeAccounts(ids, family._id);
  await PlayerAccount.updateMany({ _id: { $in: ids } }, { $set: { familyId: family._id } });
  return sendSuccess(res, { data: await familyJson(family), message: 'تمت إضافة الحسابات' });
};

// ─── DELETE /families/:id/members/:accountId ─────────────────────────────────
// عائلة يبقى فيها أقل من حسابين لا معنى لها، فتُفكّ تلقائياً.
const removeMember = async (req, res, next) => {
  const family = await Family.findById(req.params.id);
  if (!family) return next(new AppError('العائلة غير موجودة', 404));

  const result = await PlayerAccount.updateOne(
    { _id: req.params.accountId, familyId: family._id },
    { $set: { familyId: null } }
  );
  if (!result.matchedCount) return next(new AppError('الحساب ليس ضمن هذه العائلة', 404));

  const remaining = await PlayerAccount.countDocuments({ familyId: family._id });
  if (remaining < 2) {
    await PlayerAccount.updateMany({ familyId: family._id }, { $set: { familyId: null } });
    await family.deleteOne();
    return sendSuccess(res, {
      data: null,
      message: 'تمت إزالة الحساب وفكّ العائلة لأنه لم يتبقَّ فيها حسابان',
    });
  }
  return sendSuccess(res, { data: await familyJson(family), message: 'تمت إزالة الحساب' });
};

// ─── DELETE /families/:id — فكّ العائلة ──────────────────────────────────────
const deleteFamily = async (req, res, next) => {
  const family = await Family.findById(req.params.id);
  if (!family) return next(new AppError('العائلة غير موجودة', 404));
  await PlayerAccount.updateMany({ familyId: family._id }, { $set: { familyId: null } });
  await family.deleteOne();
  return sendSuccess(res, { data: null, message: 'تم فكّ العائلة' });
};

module.exports = {
  listFamilies,
  searchCandidates,
  createFamily,
  renameFamily,
  addMembers,
  removeMember,
  deleteFamily,
  memberJson,
  academyNameMap,
};
