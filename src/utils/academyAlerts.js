const Player = require('../models/player.model');
const Academy = require('../models/academy.model');
const Subscription = require('../models/subscription.model');
const Attendance = require('../models/attendance.model');
const {
  ABSENCE_STREAK_THRESHOLD,
  ABSENCE_LOOKBACK_DAYS,
  toDateStr,
  parseDateStr,
  subDateStr,
  daysBetween,
  subscriptionStage,
  absenceStreak,
  sessionsText,
} = require('./alertRules');

// تنبيهات الإدارة تُحسب لحظياً من البيانات (لا تُخزَّن)، بمعرّفات ثابتة حتى
// تُحفظ حالتها (مقروء/مخفي) في AlertState. كانت تُحسب على الموبايل من أول 300
// لاعب فقط لكل فرع؛ هنا تشمل كل اللاعبين بخمسة استعلامات للنطاق كله.
//
// الأنواع: birthday | subscriptionExpiring | subscriptionExpired | joinRequest | absence

const SUB_TITLES = {
  exp7: 'اشتراك يقترب من الانتهاء ⚠️',
  exp2: 'اشتراك سينتهي خلال يومين ⚠️',
  exptoday: 'انتهاء اشتراك اليوم 🚨',
  expired: 'اشتراك منتهي ❌',
};

const subBody = (stage, daysLeft) => {
  switch (stage) {
    case 'exp7': return `الاشتراك سينتهي خلال ${daysLeft} أيام.`;
    case 'exp2': return daysLeft === 1 ? 'الاشتراك سينتهي غداً.' : 'الاشتراك سينتهي خلال يومين.';
    case 'exptoday': return 'الاشتراك ينتهي اليوم.';
    default: return 'الاشتراك منتهي.';
  }
};

const iso = (dateStr, hour = 8) => {
  const d = parseDateStr(dateStr);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/**
 * @param {object} opts
 * @param {mongoose.Types.ObjectId[]|null} opts.academyIds  null = كل الفروع
 * @param {boolean} opts.includeSubscriptions  المشرف المحدود لا يرى الاشتراكات
 * @param {boolean} opts.labelBranch  يسبق النص باسم الفرع (السوبر أدمن)
 * @param {string} opts.today  'YYYY-MM-DD' بتوقيت الجهاز
 */
const computeAcademyAlerts = async ({ academyIds, includeSubscriptions, labelBranch, today }) => {
  const scope = academyIds ? { academyId: { $in: academyIds } } : {};
  const lookback = parseDateStr(today);
  lookback.setDate(lookback.getDate() - ABSENCE_LOOKBACK_DAYS);
  const lookbackStr = toDateStr(lookback);

  const [academies, players, pending, latestSubs, attendance] = await Promise.all([
    Academy.find(academyIds ? { _id: { $in: academyIds } } : {}).select('name'),
    Player.find({ ...scope, isActive: true, ...Player.APPROVED_ONLY })
      .select('fullName playerCode parentPhone birthDate attendanceDays academyId created_at'),
    Player.find({ ...scope, registrationStatus: 'pending' })
      .select('fullName branch academyId created_at'),
    // آخر اشتراك لكل لاعب (تاريخ النهاية الأبعد).
    Subscription.aggregate([
      { $match: scope },
      { $sort: { endDate: -1 } },
      {
        $group: {
          _id: '$playerId',
          subId: { $first: '$_id' },
          startDate: { $first: '$startDate' },
          endDate: { $first: '$endDate' },
        },
      },
    ]),
    Attendance.find({ ...scope, date: { $gte: lookbackStr } }).select('playerId date'),
  ]);

  const branchName = new Map(academies.map((a) => [a._id.toString(), a.name]));
  const presentByPlayer = new Map();
  for (const a of attendance) {
    const key = a.playerId.toString();
    if (!presentByPlayer.has(key)) presentByPlayer.set(key, new Set());
    presentByPlayer.get(key).add(a.date);
  }
  const latestByPlayer = new Map(latestSubs.map((s) => [s._id.toString(), s]));

  const [, tm, td] = today.split('-').map(Number);
  const tomorrow = parseDateStr(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const year = today.slice(0, 4);

  const alerts = [];
  const push = (player, academyId, alert) => {
    const academyKey = academyId.toString();
    const name = branchName.get(academyKey) || 'الأكاديمية';
    alerts.push({
      isRead: false,
      playerId: player._id.toString(),
      playerName: player.fullName,
      playerCode: player.playerCode || '',
      parentPhone: player.parentPhone || null,
      academyId: academyKey,
      academyName: name,
      subscriptionEndDate: null,
      absentCount: null,
      ...alert,
      body: labelBranch ? `${name}\n${alert.body}` : alert.body,
    });
  };

  for (const p of players) {
    const pid = p._id.toString();
    const label = `${p.playerCode} - ${p.fullName}`;

    // ── أعياد الميلاد (اليوم وغداً). تاريخ الميلاد مخزّن منتصف ليل UTC.
    if (p.birthDate) {
      const bm = p.birthDate.getUTCMonth() + 1;
      const bd = p.birthDate.getUTCDate();
      if (bm === tm && bd === td) {
        push(p, p.academyId, {
          id: `birthday_${pid}_${year}`,
          type: 'birthday',
          title: 'عيد ميلاد سعيد 🎂',
          body: `${label}\nعيد ميلاد اللاعب اليوم`,
          createdAt: iso(today),
        });
      } else if (bm === tomorrow.getMonth() + 1 && bd === tomorrow.getDate()) {
        push(p, p.academyId, {
          id: `birthday_tomorrow_${pid}_${year}`,
          type: 'birthday',
          title: 'عيد ميلاد قادم 🎂',
          body: `${label}\nعيد ميلاد اللاعب غداً`,
          createdAt: iso(today),
        });
      }
    }

    const sub = latestByPlayer.get(pid);
    const endStr = sub ? subDateStr(sub.endDate) : null;
    const daysLeft = endStr ? daysBetween(today, endStr) : null;

    // ── تذكير الاشتراك: أسبوع، يومان، يوم الانتهاء، ثم منتهٍ.
    if (includeSubscriptions && sub) {
      const stage = subscriptionStage(daysLeft);
      if (stage) {
        push(p, p.academyId, {
          id: `sub_${stage}_${sub.subId}`,
          type: stage === 'exp7' || stage === 'exp2' ? 'subscriptionExpiring' : 'subscriptionExpired',
          title: SUB_TITLES[stage],
          body: `${label}\n${subBody(stage, daysLeft)}`,
          createdAt: stage === 'expired' ? iso(endStr) : iso(today),
          subscriptionEndDate: sub.endDate,
        });
      }
    }

    // ── غياب متكرر: لاعب باشتراك نشط غاب تمرينتين متتاليتين أو أكثر.
    if (sub && daysLeft >= 0 && p.attendanceDays?.length) {
      const joined = p.created_at ? toDateStr(p.created_at) : null;
      const subStart = subDateStr(sub.startDate);
      const notBefore = joined && joined > subStart ? joined : subStart;
      const streak = absenceStreak(
        p.attendanceDays, presentByPlayer.get(pid) || new Set(), today, notBefore
      );
      if (streak.count >= ABSENCE_STREAK_THRESHOLD) {
        push(p, p.academyId, {
          id: `absence_${pid}_${streak.start}`,
          type: 'absence',
          title: 'غياب متكرر ⚠️',
          body: `${label}\nغاب ${sessionsText(streak.count)} متتالية (آخرها ${streak.last})`,
          createdAt: iso(streak.last, 21),
          absentCount: streak.count,
        });
      }
    }
  }

  // ── طلبات الانضمام المعلّقة.
  for (const r of pending) {
    push(r, r.academyId, {
      id: `joinrequest_${r._id}`,
      type: 'joinRequest',
      title: 'طلب انضمام لاعب جديد 📝',
      body: `${r.fullName} — ${r.branch || ''}`,
      createdAt: (r.created_at || new Date()).toISOString(),
      parentPhone: null,
    });
  }

  return alerts;
};

module.exports = { computeAcademyAlerts };
