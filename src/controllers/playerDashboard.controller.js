const Subscription = require('../models/subscription.model');
const Attendance = require('../models/attendance.model');
const Evaluation = require('../models/evaluation.model');
const Notification = require('../models/notification.model');
const Conversation = require('../models/conversation.model');
const { sendSuccess } = require('../utils/apiResponse');

const daysBetween = (future) => {
  if (!future) return 0;
  const ms = new Date(future).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / (1000 * 60 * 60 * 24));
};

// GET /api/v1/player/dashboard  (protectPlayer) — تجميع كل ما يحتاجه اللاعب.
const getPlayerDashboard = async (req, res, next) => {
  const player = req.player; // وثيقة اللاعب (من protectPlayer)
  const playerId = player._id;
  const academyId = player.academyId;

  const [latestSub, attendanceRecords, evaluations, unreadNotifications, conversation] =
    await Promise.all([
      Subscription.findOne({ playerId }).sort({ endDate: -1 }),
      Attendance.find({ playerId }).sort({ timestamp: -1 }).limit(60),
      Evaluation.find({ playerId }).sort({ evaluationDate: -1 }).limit(10),
      Notification.countDocuments({
        recipientType: 'player',
        recipientId: playerId,
        isRead: false,
      }),
      Conversation.findOne({ academyId, playerId }),
    ]);

  const subscription = latestSub
    ? {
        _id: latestSub._id.toString(),
        startDate: latestSub.startDate,
        endDate: latestSub.endDate,
        amount: latestSub.amount,
        isActive: new Date() <= latestSub.endDate,
        daysRemaining: daysBetween(latestSub.endDate),
      }
    : null;

  const latestEvaluation = evaluations[0]
    ? {
        average: evaluations[0].average,
        evaluationDate: evaluations[0].evaluationDate,
      }
    : null;

  return sendSuccess(res, {
    message: 'تم جلب لوحة اللاعب بنجاح',
    data: {
      player: {
        _id: playerId.toString(),
        fullName: player.fullName,
        playerCode: player.playerCode,
        image_url: player.image_url || null,
        sport: player.sport || null,
      },
      schedule: {
        attendanceDays: player.attendanceDays || [],
        sport: player.sport || null,
      },
      attendance: {
        presentCount: attendanceRecords.length,
        recent: attendanceRecords.slice(0, 30).map((a) => ({
          date: a.date,
          time: a.time,
          status: a.status,
        })),
      },
      subscription,
      evaluations: evaluations.map((e) => ({
        _id: e._id.toString(),
        evaluationDate: e.evaluationDate,
        fitness: e.fitness,
        basicSkills: e.basicSkills,
        attack: e.attack,
        defense: e.defense,
        commitment: e.commitment,
        average: e.average,
        notes: e.notes || '',
      })),
      latestEvaluation,
      notifications: { unread: unreadNotifications },
      chat: {
        conversationId: conversation ? conversation._id.toString() : null,
        unread: conversation ? conversation.unreadForPlayer : 0,
      },
    },
  });
};

module.exports = { getPlayerDashboard };
