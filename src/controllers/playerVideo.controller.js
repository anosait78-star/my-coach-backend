const PlayerVideo = require('../models/playerVideo.model');
const PlayerVideoComment = require('../models/playerVideoComment.model');
const Player = require('../models/player.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { parseVideoLink, ALLOWED_HINT } = require('../utils/videoLink');
const { notify } = require('../utils/notificationService');
const { logActivity } = require('../utils/activityLogger');
const logger = require('../utils/logger');

// ─── هوية الفاعل ─────────────────────────────────────────────────────────────
// كل عملية (إعجاب/تعليق) يقوم بها إمّا اللاعب صاحب البروفايل أو أحد مدراء
// أكاديميته. نوحّد الطرفين في "actor" حتى لا يتكرّر منطق الإعجاب والتعليق
// مرتين بمسارين مختلفين.

const adminActor = (req) => ({
  type: 'academy',
  id: req.user._id,
  name: req.user.name || '',
});

const playerActor = (req) => ({
  type: 'player',
  id: req.playerAccount._id,
  name: req.player.fullName || '',
});

// ─── تحميل الفيديو مع فرض العزل ──────────────────────────────────────────────

// المدير: فيديوهات أكاديميته فقط. super_admin يتجاوز القيد (نفس نمط الألبوم).
const loadVideoAsAdmin = async (req, id) => {
  const video = await PlayerVideo.findById(id);
  if (!video) throw new AppError('الفيديو غير موجود', 404);
  if (
    req.user.role !== 'super_admin' &&
    video.academyId.toString() !== req.user.academyId?.toString()
  ) {
    throw new AppError('ليس لديك صلاحية للوصول إلى هذا الفيديو', 403);
  }
  return video;
};

// اللاعب: فيديوهات بروفايله هو فقط — عزل صارم.
const loadVideoAsPlayer = async (req, id) => {
  const video = await PlayerVideo.findById(id);
  if (!video) throw new AppError('الفيديو غير موجود', 404);
  if (video.playerId.toString() !== req.player._id.toString()) {
    throw new AppError('ليس لديك صلاحية للوصول إلى هذا الفيديو', 403);
  }
  return video;
};

// اللاعب المستهدَف يجب أن يكون داخل أكاديمية المدير.
const loadPlayerAsAdmin = async (req, playerId) => {
  const player = await Player.findById(playerId);
  if (!player) throw new AppError('اللاعب غير موجود', 404);
  if (
    req.user.role !== 'super_admin' &&
    player.academyId.toString() !== req.user.academyId?.toString()
  ) {
    throw new AppError('ليس لديك صلاحية للوصول إلى هذا اللاعب', 403);
  }
  return player;
};

// هل أعجب هذا الفاعل بالفيديو؟ (تُحسب من المصفوفة المضمَّنة قبل حذفها في toJSON)
const likedBy = (video, actor) =>
  video.likes.some(
    (l) => l.authorType === actor.type && l.authorId.toString() === actor.id.toString()
  );

const serialize = (video, actor) => ({
  ...video.toJSON(),
  likedByMe: likedBy(video, actor),
});

// صفحة موحّدة لفيديوهات لاعب واحد (Pagination + Lazy Loading).
const paginateVideos = async (playerId, actor, req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    PlayerVideo.find({ playerId }).sort({ created_at: -1 }).skip(skip).limit(limit),
    PlayerVideo.countDocuments({ playerId }),
  ]);

  return sendPaginated(res, {
    data: items.map((v) => serialize(v, actor)),
    total,
    page,
    limit,
    message: 'تم جلب الفيديوهات بنجاح',
  });
};

// ═══════════════════════ جهة المدير ═══════════════════════

// ─── GET /player-videos?playerId=... ────────────────────────────────────────
const getPlayerVideos = async (req, res, next) => {
  const player = await loadPlayerAsAdmin(req, req.query.playerId);
  return paginateVideos(player._id, adminActor(req), req, res);
};

// ─── POST /player-videos ────────────────────────────────────────────────────
const createPlayerVideo = async (req, res, next) => {
  const player = await loadPlayerAsAdmin(req, req.body.playerId);

  const link = parseVideoLink(req.body.url);
  if (!link) return next(new AppError(ALLOWED_HINT, 400));

  const title = String(req.body.title || '').trim();
  if (!title) return next(new AppError('العنوان مطلوب', 400));

  const video = await PlayerVideo.create({
    academyId: player.academyId,
    playerId: player._id,
    title,
    description: String(req.body.description || '').trim(),
    url: link.url,
    provider: link.provider,
    videoKey: link.videoKey,
    thumbnailUrl: link.thumbnailUrl,
    createdBy: req.user._id,
    createdByName: req.user.name || '',
  });

  logger.info(`Player video added: ${video._id} (player ${player._id})`);
  logActivity(req, {
    actionType: 'CREATE_PLAYER_VIDEO',
    entityType: 'PLAYER_VIDEO',
    entityId: video._id,
    entityName: title,
    academyId: player.academyId,
  });
  notify({
    recipientType: 'player',
    recipientId: player._id,
    academyId: player.academyId,
    type: 'PLAYER_VIDEO_ADDED',
    title: 'فيديو جديد في بروفايلك',
    body: title,
    meta: { videoId: video._id.toString() },
  });

  return sendSuccess(res, {
    data: serialize(video, adminActor(req)),
    message: 'تمت إضافة الفيديو بنجاح',
    statusCode: 201,
  });
};

// ─── PATCH /player-videos/:id ───────────────────────────────────────────────
const updatePlayerVideo = async (req, res, next) => {
  const video = await loadVideoAsAdmin(req, req.params.id);

  if (req.body.title !== undefined) {
    const title = String(req.body.title).trim();
    if (!title) return next(new AppError('العنوان مطلوب', 400));
    video.title = title;
  }
  if (req.body.description !== undefined) {
    video.description = String(req.body.description).trim();
  }
  if (req.body.url !== undefined) {
    const link = parseVideoLink(req.body.url);
    if (!link) return next(new AppError(ALLOWED_HINT, 400));
    video.url = link.url;
    video.provider = link.provider;
    video.videoKey = link.videoKey;
    video.thumbnailUrl = link.thumbnailUrl;
  }
  await video.save();

  logActivity(req, {
    actionType: 'UPDATE_PLAYER_VIDEO',
    entityType: 'PLAYER_VIDEO',
    entityId: video._id,
    entityName: video.title,
    academyId: video.academyId,
  });
  return sendSuccess(res, {
    data: serialize(video, adminActor(req)),
    message: 'تم تحديث الفيديو بنجاح',
  });
};

// ─── DELETE /player-videos/:id ──────────────────────────────────────────────
const deletePlayerVideo = async (req, res, next) => {
  const video = await loadVideoAsAdmin(req, req.params.id);

  // التعليقات تُحذف مع الفيديو — لا تُترك يتيمة.
  await PlayerVideoComment.deleteMany({ videoId: video._id });
  await video.deleteOne();

  logActivity(req, {
    actionType: 'DELETE_PLAYER_VIDEO',
    entityType: 'PLAYER_VIDEO',
    entityId: video._id,
    entityName: video.title,
    academyId: video.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف الفيديو بنجاح' });
};

// ═══════════════════════ جهة اللاعب ═══════════════════════

// ─── GET /player/videos ─────────────────────────────────────────────────────
const getMyVideos = async (req, res, next) =>
  paginateVideos(req.player._id, playerActor(req), req, res);

// ═══════════════════════ إعجاب (مشترك) ═══════════════════════

const applyLike = async (video, actor, liked) => {
  const already = likedBy(video, actor);
  if (liked && !already) {
    video.likes.push({ authorType: actor.type, authorId: actor.id, authorName: actor.name });
    await video.save();
  } else if (!liked && already) {
    video.likes = video.likes.filter(
      (l) =>
        !(l.authorType === actor.type && l.authorId.toString() === actor.id.toString())
    );
    await video.save();
  }
  return video;
};

const likeAsAdmin = async (req, res) => {
  const video = await applyLike(await loadVideoAsAdmin(req, req.params.id), adminActor(req), true);
  return sendSuccess(res, { data: serialize(video, adminActor(req)), message: 'تم الإعجاب' });
};

const unlikeAsAdmin = async (req, res) => {
  const video = await applyLike(await loadVideoAsAdmin(req, req.params.id), adminActor(req), false);
  return sendSuccess(res, { data: serialize(video, adminActor(req)), message: 'تم إلغاء الإعجاب' });
};

const likeAsPlayer = async (req, res) => {
  const video = await applyLike(await loadVideoAsPlayer(req, req.params.id), playerActor(req), true);
  return sendSuccess(res, { data: serialize(video, playerActor(req)), message: 'تم الإعجاب' });
};

const unlikeAsPlayer = async (req, res) => {
  const video = await applyLike(await loadVideoAsPlayer(req, req.params.id), playerActor(req), false);
  return sendSuccess(res, { data: serialize(video, playerActor(req)), message: 'تم إلغاء الإعجاب' });
};

// ═══════════════════════ تعليقات (مشترك) ═══════════════════════

const listComments = async (video, req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    PlayerVideoComment.find({ videoId: video._id })
      .sort({ created_at: 1 })
      .skip(skip)
      .limit(limit),
    PlayerVideoComment.countDocuments({ videoId: video._id }),
  ]);

  return sendPaginated(res, {
    data: items.map((c) => c.toJSON()),
    total,
    page,
    limit,
    message: 'تم جلب التعليقات بنجاح',
  });
};

const addComment = async (video, actor, req, res, next) => {
  const text = String(req.body.text || '').trim();
  if (!text) return next(new AppError('نص التعليق مطلوب', 400));
  if (text.length > 1000) {
    return next(new AppError('التعليق لا يمكن أن يتجاوز 1000 حرف', 400));
  }

  const comment = await PlayerVideoComment.create({
    videoId: video._id,
    academyId: video.academyId,
    playerId: video.playerId,
    authorType: actor.type,
    authorId: actor.id,
    authorName: actor.name,
    text,
  });

  // العدّاد مُشتق — نزيده ذرّياً بدل إعادة العدّ.
  await PlayerVideo.updateOne({ _id: video._id }, { $inc: { commentsCount: 1 } });

  // نُعلم الطرف الآخر فقط: تعليق الإدارة يصل اللاعب، وتعليق اللاعب يصل الإدارة.
  if (actor.type === 'academy') {
    notify({
      recipientType: 'player',
      recipientId: video.playerId,
      academyId: video.academyId,
      type: 'PLAYER_VIDEO_COMMENT',
      title: 'تعليق جديد على فيديو في بروفايلك',
      body: text.slice(0, 120),
      meta: { videoId: video._id.toString() },
    });
  } else {
    notify({
      recipientType: 'academy',
      recipientId: video.academyId,
      academyId: video.academyId,
      type: 'PLAYER_VIDEO_COMMENT',
      title: 'تعليق جديد من لاعب على فيديو',
      body: text.slice(0, 120),
      meta: { videoId: video._id.toString(), playerId: video.playerId.toString() },
    });
  }

  return sendSuccess(res, {
    data: comment.toJSON(),
    message: 'تمت إضافة التعليق',
    statusCode: 201,
  });
};

// حذف تعليق: الإدارة تحذف أي تعليق على فيديوهات أكاديميتها، واللاعب يحذف
// تعليقه هو فقط.
const removeComment = async (video, actor, req, res, next) => {
  const comment = await PlayerVideoComment.findOne({
    _id: req.params.commentId,
    videoId: video._id,
  });
  if (!comment) return next(new AppError('التعليق غير موجود', 404));

  const isOwner =
    comment.authorType === actor.type &&
    comment.authorId.toString() === actor.id.toString();
  if (actor.type !== 'academy' && !isOwner) {
    return next(new AppError('لا يمكنك حذف تعليق غيرك', 403));
  }

  await comment.deleteOne();
  await PlayerVideo.updateOne(
    { _id: video._id, commentsCount: { $gt: 0 } },
    { $inc: { commentsCount: -1 } }
  );

  return sendSuccess(res, { message: 'تم حذف التعليق' });
};

// ─── أغلفة المسارات ─────────────────────────────────────────────────────────

const listCommentsAsAdmin = async (req, res) =>
  listComments(await loadVideoAsAdmin(req, req.params.id), req, res);

const addCommentAsAdmin = async (req, res, next) =>
  addComment(await loadVideoAsAdmin(req, req.params.id), adminActor(req), req, res, next);

const removeCommentAsAdmin = async (req, res, next) =>
  removeComment(await loadVideoAsAdmin(req, req.params.id), adminActor(req), req, res, next);

const listCommentsAsPlayer = async (req, res) =>
  listComments(await loadVideoAsPlayer(req, req.params.id), req, res);

const addCommentAsPlayer = async (req, res, next) =>
  addComment(await loadVideoAsPlayer(req, req.params.id), playerActor(req), req, res, next);

const removeCommentAsPlayer = async (req, res, next) =>
  removeComment(await loadVideoAsPlayer(req, req.params.id), playerActor(req), req, res, next);

module.exports = {
  // مدير
  getPlayerVideos,
  createPlayerVideo,
  updatePlayerVideo,
  deletePlayerVideo,
  likeAsAdmin,
  unlikeAsAdmin,
  listCommentsAsAdmin,
  addCommentAsAdmin,
  removeCommentAsAdmin,
  // لاعب
  getMyVideos,
  likeAsPlayer,
  unlikeAsPlayer,
  listCommentsAsPlayer,
  addCommentAsPlayer,
  removeCommentAsPlayer,
};
