const mongoose = require('mongoose');
const Conversation = require('../models/conversation.model');
const Message = require('../models/message.model');
const Player = require('../models/player.model');
const Academy = require('../models/academy.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { notify } = require('../utils/notificationService');

// يجد محادثة (أكاديمية، لاعب) أو يُنشئها. محادثة واحدة فريدة لكل زوج.
const findOrCreateConversation = async (academyId, playerId) => {
  let convo = await Conversation.findOne({ academyId, playerId });
  if (!convo) {
    convo = await Conversation.create({ academyId, playerId });
  }
  return convo;
};

const serializeMessage = (m) => ({
  _id: m._id.toString(),
  senderType: m.senderType,
  text: m.text,
  created_at: m.created_at,
  readAt: m.readAt,
});

// ─────────────────────────────── جهة الأكاديمية ───────────────────────────────

// GET /api/v1/chat/conversations — قائمة محادثات الأكاديمية.
// السوبر أدمن بلا أكاديمية ثابتة: يرى محادثات كل الفروع (أو فرعاً واحداً عبر
// ?academyId=) مع اسم الفرع على كل محادثة. أي دور آخر مُقيَّد بأكاديميته.
const getAcademyConversations = async (req, res, next) => {
  const isSuper = req.user.role === 'super_admin';
  let filter;
  if (isSuper) {
    const scope = req.query.academyId;
    if (scope && scope !== 'all' && !mongoose.Types.ObjectId.isValid(String(scope))) {
      return next(new AppError('معرّف الأكاديمية غير صحيح', 400));
    }
    filter = scope && scope !== 'all' ? { academyId: scope } : {};
  } else {
    if (!req.user.academyId) return next(new AppError('معرّف الأكاديمية مطلوب', 400));
    filter = { academyId: req.user.academyId };
  }

  const convos = await Conversation.find(filter)
    .sort({ lastMessageAt: -1, updated_at: -1 })
    .populate('playerId', 'fullName playerCode image_url');

  let academyNames = new Map();
  if (isSuper) {
    const ids = [...new Set(convos.map((c) => c.academyId.toString()))];
    const academies = await Academy.find({ _id: { $in: ids } }).select('name');
    academyNames = new Map(academies.map((a) => [a._id.toString(), a.name]));
  }

  const data = convos
    .filter((c) => c.playerId) // تجاهل لاعب محذوف
    .map((c) => ({
      _id: c._id.toString(),
      academyId: c.academyId.toString(),
      academyName: academyNames.get(c.academyId.toString()) || null,
      player: {
        _id: c.playerId._id.toString(),
        fullName: c.playerId.fullName,
        playerCode: c.playerId.playerCode,
        image_url: c.playerId.image_url || null,
      },
      lastMessage: c.lastMessage,
      lastMessageAt: c.lastMessageAt,
      unread: c.unreadForAcademy,
    }));

  return sendSuccess(res, { data, message: 'تم جلب المحادثات بنجاح' });
};

// يحمّل لاعب المحادثة. المحادثة دائماً على أكاديمية اللاعب نفسه؛ السوبر أدمن
// يصل لأي لاعب، وأي دور آخر للاعبي أكاديميته فقط.
const loadChatPlayer = async (req) => {
  const player = await Player.findById(req.params.playerId).select('academyId fullName');
  if (!player) throw new AppError('اللاعب غير موجود', 404);
  if (req.user.role !== 'super_admin') {
    if (!req.user.academyId) throw new AppError('معرّف الأكاديمية مطلوب', 400);
    if (player.academyId.toString() !== req.user.academyId.toString()) {
      throw new AppError('هذا اللاعب لا ينتمي إلى أكاديميتك', 403);
    }
  }
  return player;
};

// GET /api/v1/chat/conversations/:playerId/messages — رسائل محادثة لاعب (جهة الأكاديمية).
const getAcademyMessages = async (req, res) => {
  const { playerId } = req.params;
  const player = await loadChatPlayer(req);
  const academyId = player.academyId;

  const convo = await findOrCreateConversation(academyId, playerId);
  const messages = await Message.find({ conversationId: convo._id }).sort({ created_at: 1 }).limit(500);

  // تعليم رسائل اللاعب كمقروءة من جهة الأكاديمية.
  if (convo.unreadForAcademy > 0) {
    convo.unreadForAcademy = 0;
    await convo.save();
    await Message.updateMany(
      { conversationId: convo._id, senderType: 'player', readAt: null },
      { $set: { readAt: new Date() } }
    );
  }

  return sendSuccess(res, {
    data: {
      conversationId: convo._id.toString(),
      player: { _id: playerId, fullName: player.fullName },
      messages: messages.map(serializeMessage),
    },
    message: 'تم جلب الرسائل بنجاح',
  });
};

// POST /api/v1/chat/conversations/:playerId/messages — رد الأكاديمية على لاعب.
const academySendMessage = async (req, res, next) => {
  const { playerId } = req.params;
  const text = String(req.body.text || '').trim();
  if (!text) return next(new AppError('نص الرسالة مطلوب', 400));

  const player = await loadChatPlayer(req);
  const academyId = player.academyId;

  const convo = await findOrCreateConversation(academyId, playerId);
  const message = await Message.create({
    conversationId: convo._id,
    academyId,
    playerId,
    senderType: 'academy',
    senderId: req.user._id,
    text,
  });

  convo.lastMessage = text;
  convo.lastMessageAt = new Date();
  convo.unreadForPlayer += 1;
  await convo.save();

  // نُنشئ إشعار NEW_MESSAGE للاستخدام المستقبلي (Push Notifications)، لكنه
  // مُستبعَد من مركز إشعارات النظام في العرض (انظر notification.controller).
  // عدّاد رسائل اللاعب مصدره unreadForPlayer وحده، لا مركز الإشعارات.
  notify({
    recipientType: 'player', recipientId: playerId, academyId,
    type: 'NEW_MESSAGE', title: 'رسالة جديدة من الأكاديمية',
    body: text.length > 80 ? text.slice(0, 80) + '…' : text,
    meta: { conversationId: convo._id.toString() },
  });

  return sendSuccess(res, {
    data: serializeMessage(message),
    message: 'تم إرسال الرسالة بنجاح',
    statusCode: 201,
  });
};

// ─────────────────────────────── جهة اللاعب ───────────────────────────────

// GET /api/v1/player/chat — محادثة اللاعب الوحيدة مع أكاديميته + الرسائل.
const getPlayerConversation = async (req, res, next) => {
  const player = req.player;
  const convo = await findOrCreateConversation(player.academyId, player._id);
  const messages = await Message.find({ conversationId: convo._id }).sort({ created_at: 1 }).limit(500);

  if (convo.unreadForPlayer > 0) {
    convo.unreadForPlayer = 0;
    await convo.save();
    await Message.updateMany(
      { conversationId: convo._id, senderType: 'academy', readAt: null },
      { $set: { readAt: new Date() } }
    );
  }

  return sendSuccess(res, {
    data: {
      conversationId: convo._id.toString(),
      messages: messages.map(serializeMessage),
    },
    message: 'تم جلب المحادثة بنجاح',
  });
};

// POST /api/v1/player/chat — إرسال اللاعب رسالة لأكاديميته.
const playerSendMessage = async (req, res, next) => {
  const player = req.player;
  const text = String(req.body.text || '').trim();
  if (!text) return next(new AppError('نص الرسالة مطلوب', 400));

  const convo = await findOrCreateConversation(player.academyId, player._id);
  const message = await Message.create({
    conversationId: convo._id,
    academyId: player.academyId,
    playerId: player._id,
    senderType: 'player',
    senderId: req.playerAccount._id,
    text,
  });

  convo.lastMessage = text;
  convo.lastMessageAt = new Date();
  convo.unreadForAcademy += 1;
  await convo.save();

  // نُنشئ إشعار NEW_MESSAGE للاستخدام المستقبلي (Push Notifications)، لكنه
  // مُستبعَد من مركز إشعارات النظام في العرض (انظر notification.controller).
  // عدّاد رسائل المدير مصدره unreadForAcademy وحده، لا مركز الإشعارات.
  notify({
    recipientType: 'academy', recipientId: player.academyId, academyId: player.academyId,
    type: 'NEW_MESSAGE', title: `رسالة جديدة من ${player.fullName}`,
    body: text.length > 80 ? text.slice(0, 80) + '…' : text,
    meta: { conversationId: convo._id.toString(), playerId: player._id.toString() },
  });

  return sendSuccess(res, {
    data: serializeMessage(message),
    message: 'تم إرسال الرسالة بنجاح',
    statusCode: 201,
  });
};

module.exports = {
  getAcademyConversations,
  getAcademyMessages,
  academySendMessage,
  getPlayerConversation,
  playerSendMessage,
};
