const mongoose = require('mongoose');
const Player = require('../models/player.model');
const Subscription = require('../models/subscription.model');
const Evaluation = require('../models/evaluation.model');
const Activity = require('../models/activity.model');
const Group = require('../models/group.model');
const { sendSuccess } = require('../utils/apiResponse');
const AppError = require('../utils/AppError');

// Helper: build academy match stage
const buildAcademyMatch = (req) => {
  const isSuperAdmin = req.user.role === 'super_admin';
  if (isSuperAdmin && req.query.academyId) {
    return { academyId: new mongoose.Types.ObjectId(req.query.academyId) };
  }
  if (!isSuperAdmin) {
    return { academyId: req.user.academyId };
  }
  return {}; // super_admin with no filter: all academies
};

// GET /api/v1/dashboard/stats
const getDashboardStats = async (req, res, next) => {
  const match = buildAcademyMatch(req);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [playerStats, subscriptionStats, evaluationStats, groupStats] = await Promise.all([
    // 1. Players aggregation
    Player.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalPlayers: { $sum: 1 },
          activePlayers: { $sum: { $cond: ['$isActive', 1, 0] } },
          // لاعبون نشطون بلا مجموعة (groupId = null أو غير موجود).
          playersWithoutGroup: {
            $sum: {
              $cond: [
                { $and: ['$isActive', { $eq: ['$groupId', null] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),

    // 2. Subscriptions $facet aggregation
    Subscription.aggregate([
      { $match: match },
      {
        $facet: {
          activeSubscriptions: [
            { $match: { endDate: { $gte: now } } },
            { $count: 'count' },
          ],
          expiredSubscriptions: [
            { $match: { endDate: { $lt: now } } },
            { $count: 'count' },
          ],
          totalRevenue: [
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ],
          currentMonthRevenue: [
            { $match: { created_at: { $gte: startOfMonth, $lte: endOfMonth } } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ],
          newSubscriptionsCount: [
            { $match: { type: 'NEW_SUBSCRIPTION' } },
            { $count: 'count' },
          ],
          renewalsCount: [
            { $match: { type: 'RENEWAL' } },
            { $count: 'count' },
          ],
        },
      },
    ]),

    // 3. Evaluations average
    Evaluation.aggregate([
      { $match: match },
      { $group: { _id: null, averageEvaluationScore: { $avg: '$average' } } },
    ]),

    // 4. Groups aggregation — يُرفق عدد اللاعبين النشطين لكل مجموعة لحساب الإحصاءات.
    Group.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'players',
          let: { gid: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$groupId', '$$gid'] },
                    { $eq: ['$isActive', true] },
                  ],
                },
              },
            },
            { $count: 'c' },
          ],
          as: 'playersArr',
        },
      },
      {
        $addFields: {
          playersCount: { $ifNull: [{ $arrayElemAt: ['$playersArr.c', 0] }, 0] },
        },
      },
      {
        $group: {
          _id: null,
          totalGroups: { $sum: 1 },
          activeGroups: { $sum: { $cond: ['$isActive', 1, 0] } },
          totalPlayersInGroups: { $sum: '$playersCount' },
          totalCapacity: { $sum: { $ifNull: ['$capacity', 0] } },
          largestGroupSize: { $max: '$playersCount' },
        },
      },
    ]),
  ]);

  const players = playerStats[0] || { totalPlayers: 0, activePlayers: 0, playersWithoutGroup: 0 };
  const groups = groupStats[0] || {
    totalGroups: 0,
    activeGroups: 0,
    totalPlayersInGroups: 0,
    totalCapacity: 0,
    largestGroupSize: 0,
  };

  // إحصاءات مجموعات مُشتقّة (للقراءة فقط — لا تُخزَّن).
  const totalGroups = groups.totalGroups || 0;
  const avgPlayersPerGroup = totalGroups
    ? Math.round(((groups.totalPlayersInGroups || 0) / totalGroups) * 10) / 10
    : 0;
  const groupOccupancyRate = groups.totalCapacity
    ? Math.round(((groups.totalPlayersInGroups || 0) / groups.totalCapacity) * 100)
    : 0;
  const subs = subscriptionStats[0] || {};

  const extract = (facetArr) => (facetArr && facetArr[0] ? facetArr[0] : {});

  const activeSubsDoc = extract(subs.activeSubscriptions);
  const expiredSubsDoc = extract(subs.expiredSubscriptions);
  const totalRevDoc = extract(subs.totalRevenue);
  const monthRevDoc = extract(subs.currentMonthRevenue);
  const newSubsDoc = extract(subs.newSubscriptionsCount);
  const renewalsDoc = extract(subs.renewalsCount);

  const evalStats = evaluationStats[0] || { averageEvaluationScore: 0 };

  sendSuccess(res, {
    data: {
      totalPlayers: players.totalPlayers || 0,
      activePlayers: players.activePlayers || 0,
      activeSubscriptions: activeSubsDoc.count || 0,
      expiredSubscriptions: expiredSubsDoc.count || 0,
      totalRevenue: totalRevDoc.total || 0,
      currentMonthRevenue: monthRevDoc.total || 0,
      newSubscriptionsCount: newSubsDoc.count || 0,
      renewalsCount: renewalsDoc.count || 0,
      averageEvaluationScore: Math.round((evalStats.averageEvaluationScore || 0) * 100) / 100,
      totalGroups: groups.totalGroups || 0,
      activeGroups: groups.activeGroups || 0,
      playersWithoutGroup: players.playersWithoutGroup || 0,
      largestGroupSize: groups.largestGroupSize || 0,
      groupOccupancyRate,
      avgPlayersPerGroup,
    },
  });
};

// GET /api/v1/dashboard/revenue-by-month
const getRevenueByMonth = async (req, res, next) => {
  const match = buildAcademyMatch(req);
  const now = new Date();
  // Start of 12 months ago (first day)
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const matchWithDate = { ...match, created_at: { $gte: twelveMonthsAgo } };

  const results = await Subscription.aggregate([
    { $match: matchWithDate },
    {
      $group: {
        _id: { year: { $year: '$created_at' }, month: { $month: '$created_at' } },
        revenue: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  // Build a map of existing data
  const dataMap = {};
  for (const item of results) {
    const key = `${item._id.year}-${String(item._id.month).padStart(2, '0')}`;
    dataMap[key] = { revenue: item.revenue, count: item.count };
  }

  // Fill all 12 months
  const filled = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    filled.push({
      month: key,
      revenue: dataMap[key] ? dataMap[key].revenue : 0,
      count: dataMap[key] ? dataMap[key].count : 0,
    });
  }

  sendSuccess(res, { data: filled });
};

// GET /api/v1/dashboard/subscriptions-by-type
const getSubscriptionsByType = async (req, res, next) => {
  const match = buildAcademyMatch(req);

  const results = await Subscription.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
      },
    },
  ]);

  const output = { NEW_SUBSCRIPTION: 0, RENEWAL: 0, total: 0 };
  for (const item of results) {
    if (item._id === 'NEW_SUBSCRIPTION') output.NEW_SUBSCRIPTION = item.count;
    else if (item._id === 'RENEWAL') output.RENEWAL = item.count;
    output.total += item.count;
  }

  sendSuccess(res, { data: output });
};

// GET /api/v1/dashboard/players-by-birth-year
const getPlayersByBirthYear = async (req, res, next) => {
  const match = buildAcademyMatch(req);
  const activeMatch = { ...match, isActive: true };

  const results = await Player.aggregate([
    { $match: activeMatch },
    {
      $group: {
        _id: { $year: '$birthDate' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 0 } } },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        year: '$_id',
        count: 1,
      },
    },
  ]);

  sendSuccess(res, { data: results });
};

// GET /api/v1/dashboard/evaluation-distribution
const getEvaluationDistribution = async (req, res, next) => {
  const match = buildAcademyMatch(req);

  const results = await Evaluation.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        excellent: { $sum: { $cond: [{ $gte: ['$average', 8] }, 1, 0] } },
        good: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ['$average', 6] }, { $lt: ['$average', 8] }] },
              1,
              0,
            ],
          },
        },
        needsImprovement: { $sum: { $cond: [{ $lt: ['$average', 6] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
  ]);

  const doc = results[0] || { excellent: 0, good: 0, needsImprovement: 0, total: 0 };

  sendSuccess(res, {
    data: {
      excellent: doc.excellent || 0,
      good: doc.good || 0,
      needsImprovement: doc.needsImprovement || 0,
      total: doc.total || 0,
    },
  });
};

// GET /api/v1/dashboard/recent-activities
// يُرجع سجل النشاط الحقيقي (من قام بالإجراء) — الأحدث أولاً.
const getRecentActivities = async (req, res, next) => {
  const match = buildAcademyMatch(req);

  const activities = await Activity.find(match)
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const data = activities.map((a) => ({
    id: a._id.toString(),
    userName: a.userName || '',
    actionType: a.actionType,
    entityType: a.entityType,
    entityName: a.entityName || '',
    createdAt: a.createdAt,
  }));

  sendSuccess(res, { data });
};

// GET /api/v1/dashboard/sport-stats?sport=...&academyId=...
// Per-sport statistics: players count, active/expired subscriptions,
// revenue, and the latest players — all scoped to a single sport.
const getSportStats = async (req, res, next) => {
  const match = buildAcademyMatch(req);
  const sport = req.query.sport ? String(req.query.sport).trim() : '';
  if (!sport) return next(new AppError('الرياضة مطلوبة', 400));

  const now = new Date();
  const playerMatch = { ...match, sport, isActive: true };

  const [totalPlayers, recentPlayers, subStats] = await Promise.all([
    Player.countDocuments(playerMatch),

    Player.find(playerMatch)
      .sort({ created_at: -1 })
      .limit(5)
      .select('playerCode fullName image_url birthDate sport created_at'),

    // Subscriptions joined to their player, filtered by the player's sport.
    Subscription.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'players',
          localField: 'playerId',
          foreignField: '_id',
          as: 'player',
        },
      },
      { $unwind: '$player' },
      { $match: { 'player.sport': sport } },
      {
        $facet: {
          active: [{ $match: { endDate: { $gte: now } } }, { $count: 'count' }],
          expired: [{ $match: { endDate: { $lt: now } } }, { $count: 'count' }],
          revenue: [{ $group: { _id: null, total: { $sum: '$amount' } } }],
        },
      },
    ]),
  ]);

  const subs = subStats[0] || {};
  const extract = (a) => (a && a[0] ? a[0] : {});

  sendSuccess(res, {
    data: {
      sport,
      totalPlayers: totalPlayers || 0,
      activeSubscriptions: extract(subs.active).count || 0,
      expiredSubscriptions: extract(subs.expired).count || 0,
      revenue: extract(subs.revenue).total || 0,
      recentPlayers,
    },
  });
};

module.exports = {
  getDashboardStats,
  getRevenueByMonth,
  getSubscriptionsByType,
  getPlayersByBirthYear,
  getEvaluationDistribution,
  getRecentActivities,
  getSportStats,
};
