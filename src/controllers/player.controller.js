const Player = require('../models/player.model');
const Academy = require('../models/academy.model');
const Group = require('../models/group.model');
const PlayerAccount = require('../models/playerAccount.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');
const { generateStrongPassword } = require('../utils/generatePassword');
const AcademySubscription = require('../models/academySubscription.model');
const escapeRegex = require('../utils/escapeRegex');

// إشارة داخلية: تخطّي إنشاء حساب اللاعب لأن بوابة اللاعب غير مفعّلة.
class PortalDisabledSkip extends Error {}

// Normalize an array field coming from multipart/form-data.
// Accepts: a real array, a JSON-encoded array string, or a comma-separated string.
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

// يتحقق من صحة المجموعة المُختارة للاعب: موجودة ونفس الأكاديمية فقط.
// المجموعات أقسام تنظيمية مستقلة عن الرياضة — لا يوجد تحقق رياضة إطلاقاً.
const validateGroupForPlayer = async (groupId, academyId) => {
  const group = await Group.findById(groupId);
  if (!group) throw new AppError('المجموعة غير موجودة', 404);
  if (group.academyId.toString() !== academyId.toString()) {
    throw new AppError('المجموعة لا تنتمي لهذه الأكاديمية', 422);
  }
  return group;
};

// ─── GET /players ───────────────────────────────────────────────────────────
const getPlayers = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  // Build base filter
  const filter = {};

  // Active filter (super_admin can request inactive players)
  if (req.query.showInactive === 'true' && req.user.role === 'super_admin') {
    // no isActive filter — show all
  } else {
    filter.isActive = true;
  }

  // Academy scope — كل مستخدم غير super_admin مُقيَّد حتمياً بأكاديميته.
  // super_admin فقط يمرّر academyId صراحةً. (يشمل دور admin + academy_admin.)
  if (req.user.role === 'super_admin') {
    if (!req.query.academyId) {
      return next(new AppError('معرّف الأكاديمية مطلوب', 400));
    }
    filter.academyId = req.query.academyId;
  } else {
    filter.academyId = req.user.academyId;
  }

  // Birth year filter
  if (req.query.birthYear) {
    const year = parseInt(req.query.birthYear, 10);
    if (!isNaN(year)) {
      filter.birthDate = {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${year + 1}-01-01`),
      };
    }
  }

  // Sport filter (multi-sport academies)
  if (req.query.sport && req.query.sport.trim().length > 0) {
    filter.sport = req.query.sport.trim();
  }

  // Group filter — بُعد فلترة مستقل عن الرياضة. يدعم Sport + Group معاً.
  // 'none' = اللاعبون بلا مجموعة.
  if (req.query.groupId && req.query.groupId.trim().length > 0) {
    const g = req.query.groupId.trim();
    filter.groupId = g === 'none' ? null : g;
  }

  // Attendance-day filter — matches players whose attendanceDays array contains the day
  if (req.query.attendanceDay && req.query.attendanceDay.trim().length > 0) {
    filter.attendanceDays = req.query.attendanceDay.trim();
  }

  // Account filter (Player Portal) — 'true' = لديهم حساب، 'false' = بدون حساب.
  // إضافي بالكامل: غياب البارامتر = السلوك القديم تماماً.
  if (req.query.hasAccount === 'true' || req.query.hasAccount === 'false') {
    const accountPlayerIds = await PlayerAccount.find({ academyId: filter.academyId }).distinct('playerId');
    filter._id = req.query.hasAccount === 'true'
      ? { $in: accountPlayerIds }
      : { $nin: accountPlayerIds };
  }

  // Search
  if (req.query.search && req.query.search.trim().length > 0) {
    const searchTerm = req.query.search.trim();
    try {
      // Try text index first
      filter.$text = { $search: searchTerm };
    } catch (e) {
      // Fallback to regex search
      const regex = new RegExp(escapeRegex(searchTerm), 'i');
      filter.$or = [
        { fullName: regex },
        { playerCode: regex },
        { parentPhone: regex },
      ];
    }
  }

  const [players, total] = await Promise.all([
    Player.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
    Player.countDocuments(filter),
  ]);

  return sendPaginated(res, {
    data: players,
    total,
    page,
    limit,
    message: 'تم جلب اللاعبين بنجاح',
  });
};

// ─── GET /players/search ─────────────────────────────────────────────────────
const searchPlayers = async (req, res, next) => {
  const q = req.query.q ? req.query.q.trim() : '';
  if (q.length < 2) {
    return next(new AppError('يجب أن يكون نص البحث حرفين على الأقل', 400));
  }

  const regex = new RegExp(escapeRegex(q), 'i');
  const filter = {
    isActive: true,
    $or: [
      { fullName: regex },
      { playerCode: regex },
      { parentPhone: regex },
    ],
  };

  if (req.user.role === 'super_admin') {
    if (!req.query.academyId) {
      return next(new AppError('معرّف الأكاديمية مطلوب للبحث', 400));
    }
    filter.academyId = req.query.academyId;
  } else {
    filter.academyId = req.user.academyId;
  }

  const players = await Player.find(filter).sort({ created_at: -1 }).limit(50);

  return sendSuccess(res, { data: players, message: 'تم البحث بنجاح' });
};

// ─── GET /players/:id ────────────────────────────────────────────────────────
const getPlayerById = async (req, res, next) => {
  const player = await Player.findById(req.params.id);
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  if (req.user.role !== 'super_admin' &&
      player.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى هذا اللاعب', 403));
  }

  return sendSuccess(res, { data: player, message: 'تم جلب بيانات اللاعب بنجاح' });
};

// ─── POST /players ───────────────────────────────────────────────────────────
const createPlayer = async (req, res, next) => {
  // Determine academyId — super_admin يحدّدها، غيره مُقيَّد بأكاديميته.
  let academyId;
  if (req.user.role === 'super_admin') {
    academyId = req.body.academyId;
    if (!academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
  } else {
    academyId = req.user.academyId;
  }

  const {
    fullName,
    birthDate,
    parentName,
    parentRelationship,
    parentJob,
    parentPhone,
    playerPhone,
    notes,
    sport,
  } = req.body;

  const playerData = {
    academyId,
    fullName,
    birthDate,
    parentName,
    parentRelationship,
    parentPhone,
  };

  if (parentJob !== undefined) playerData.parentJob = parentJob;
  if (playerPhone !== undefined) playerData.playerPhone = playerPhone;
  if (notes !== undefined) playerData.notes = notes;

  // ── Sport assignment ──────────────────────────────────────────────────────
  // Single-sport academy → assign its only sport automatically.
  // Multi-sport academy   → `sport` is required and must be one of academy.sports.
  const academy = await Academy.findById(academyId).select('sports');
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));
  const academySports = Array.isArray(academy.sports) && academy.sports.length > 0
    ? academy.sports
    : ['كرة سلة'];

  if (academySports.length === 1) {
    playerData.sport = academySports[0];
  } else {
    const chosen = sport ? String(sport).trim() : '';
    if (!chosen) return next(new AppError('الرياضة مطلوبة', 422));
    if (!academySports.includes(chosen)) {
      return next(new AppError('الرياضة المختارة غير متاحة في هذه الأكاديمية', 422));
    }
    playerData.sport = chosen;
  }

  // ── Group assignment ──────────────────────────────────────────────────────
  // المجموعة اختيارية دائماً. إن اختِيرت يتم التحقق من انتمائها للأكاديمية فقط.
  if (req.body.groupId) {
    const group = await validateGroupForPlayer(req.body.groupId, academyId);
    playerData.groupId = group._id;
  } else {
    playerData.groupId = null;
  }

  // ── Attendance days ───────────────────────────────────────────────────────
  const attendanceDays = parseArrayField(req.body.attendanceDays);
  if (attendanceDays !== undefined) playerData.attendanceDays = attendanceDays;

  if (req.file) {
    playerData.image_url = req.file.path;
    playerData.image_public_id = req.file.filename;
  }

  const player = await Player.create(playerData);

  // إنشاء حساب دخول للاعب تلقائياً (اسم مستخدم عالمي nosait00001 + كلمة مرور قوية)
  // فقط إذا كانت ميزة بوابة اللاعب مفعّلة لهذه الأكاديمية (playerPortalEnabled).
  // best-effort: إن فشل لا نُفشل إنشاء اللاعب، لكن نُبلّغ الواجهة بغياب الحساب.
  let account = null;
  try {
    const platformSub = await AcademySubscription.findOne({ academyId: player.academyId });
    if (!platformSub || platformSub.playerPortalEnabled !== true) {
      throw new PortalDisabledSkip();
    }
    const username = await PlayerAccount.generateUsername();
    const plainPassword = generateStrongPassword(10);
    const created = await PlayerAccount.create({
      playerId: player._id,
      academyId: player.academyId,
      username,
      password: plainPassword,
    });
    // نُرجع كلمة المرور النصية مرة واحدة فقط لعرضها في نافذة البيانات.
    account = { _id: created._id.toString(), username, password: plainPassword };
  } catch (accErr) {
    if (accErr instanceof PortalDisabledSkip) {
      logger.info(`[PLAYER-ACCOUNT] portal disabled for academy ${player.academyId} — skipping auto account for ${player.playerCode}`);
    } else {
      logger.warn(`[PLAYER-ACCOUNT] failed to create account for ${player.playerCode}: ${accErr.message}`);
    }
  }

  logger.info(`Player created: ${player.playerCode} - ${player.fullName}`);
  logActivity(req, {
    actionType: 'CREATE_PLAYER', entityType: 'PLAYER',
    entityId: player._id, entityName: player.fullName, academyId: player.academyId,
  });
  // نُبقي data = وثيقة اللاعب كما كانت (توافق كامل مع الواجهة الحالية)،
  // ونضيف account كحقل جانبي جديد فقط (إضافة غير كاسرة).
  return res.status(201).json({
    success: true,
    message: 'تم إضافة اللاعب بنجاح',
    data: player,
    account,
  });
};

// ─── PUT /players/:id ────────────────────────────────────────────────────────
const updatePlayer = async (req, res, next) => {
  const player = await Player.findById(req.params.id).select('+image_public_id');
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  if (req.user.role !== 'super_admin' &&
      player.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذا اللاعب', 403));
  }

  // Allowed updatable fields (playerCode is NOT updatable)
  const allowedFields = ['fullName', 'birthDate', 'parentName', 'parentRelationship', 'parentJob', 'parentPhone', 'playerPhone', 'notes'];
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      player[field] = req.body[field];
    }
  }

  // Sport update — validate against the academy's sports list when provided.
  if (req.body.sport !== undefined) {
    const chosen = String(req.body.sport).trim();
    const academy = await Academy.findById(player.academyId).select('sports');
    const academySports = academy && Array.isArray(academy.sports) && academy.sports.length > 0
      ? academy.sports
      : ['كرة سلة'];
    if (chosen && !academySports.includes(chosen)) {
      return next(new AppError('الرياضة المختارة غير متاحة في هذه الأكاديمية', 422));
    }
    if (chosen) player.sport = chosen;
  }

  // Group update
  if (req.body.groupId !== undefined) {
    if (!req.body.groupId) {
      player.groupId = null;
    } else {
      const group = await validateGroupForPlayer(req.body.groupId, player.academyId);
      player.groupId = group._id;
    }
  }

  // Attendance days update
  const attendanceDays = parseArrayField(req.body.attendanceDays);
  if (attendanceDays !== undefined) player.attendanceDays = attendanceDays;

  // Handle image replacement
  if (req.file) {
    if (player.image_public_id) {
      await deleteImage(player.image_public_id).catch(() => {});
    }
    player.image_url = req.file.path;
    player.image_public_id = req.file.filename;
  }

  await player.save();

  logger.info(`Player updated: ${player.playerCode} - ${player.fullName}`);
  logActivity(req, {
    actionType: 'UPDATE_PLAYER', entityType: 'PLAYER',
    entityId: player._id, entityName: player.fullName, academyId: player.academyId,
  });
  return sendSuccess(res, { data: player, message: 'تم تحديث بيانات اللاعب بنجاح' });
};

// ─── DELETE /players/:id ─────────────────────────────────────────────────────
const deletePlayer = async (req, res, next) => {
  const player = await Player.findById(req.params.id);
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  if (req.user.role !== 'super_admin' &&
      player.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لحذف هذا اللاعب', 403));
  }

  player.isActive = false;
  await player.save();

  logger.info(`Player deleted (soft): ${player.playerCode} - ${player.fullName}`);
  logActivity(req, {
    actionType: 'DELETE_PLAYER', entityType: 'PLAYER',
    entityId: player._id, entityName: player.fullName, academyId: player.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف اللاعب بنجاح' });
};

// ─── DELETE /players/:id/image ───────────────────────────────────────────────
const deletePlayerImage = async (req, res, next) => {
  const player = await Player.findById(req.params.id).select('+image_public_id');
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  if (req.user.role !== 'super_admin' &&
      player.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لحذف صورة هذا اللاعب', 403));
  }

  if (!player.image_public_id) {
    return next(new AppError('لا توجد صورة لحذفها', 400));
  }

  await deleteImage(player.image_public_id);
  player.image_url = null;
  player.image_public_id = null;
  await player.save();

  return sendSuccess(res, { message: 'تم حذف صورة اللاعب بنجاح' });
};

// ─── PATCH /players/:id/change-group ─────────────────────────────────────────
const changeGroup = async (req, res, next) => {
  const player = await Player.findById(req.params.id);
  if (!player) return next(new AppError('اللاعب غير موجود', 404));

  if (req.user.role !== 'super_admin' &&
      player.academyId.toString() !== req.user.academyId?.toString()) {
    return next(new AppError('ليس لديك صلاحية لتعديل هذا اللاعب', 403));
  }

  if (!req.body.groupId) return next(new AppError('المجموعة مطلوبة', 422));

  const group = await validateGroupForPlayer(req.body.groupId, player.academyId);
  player.groupId = group._id;
  await player.save();

  logger.info(`Player group changed: ${player.playerCode} -> ${group.name}`);
  logActivity(req, {
    actionType: 'PLAYER_MOVED_BETWEEN_GROUPS', entityType: 'PLAYER',
    entityId: player._id, entityName: player.fullName, academyId: player.academyId,
  });

  return sendSuccess(res, { data: player, message: 'تم نقل اللاعب إلى المجموعة الجديدة بنجاح' });
};

module.exports = {
  getPlayers,
  searchPlayers,
  getPlayerById,
  createPlayer,
  updatePlayer,
  deletePlayer,
  deletePlayerImage,
  changeGroup,
};
