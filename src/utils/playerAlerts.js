const Notification = require('../models/notification.model');
const Subscription = require('../models/subscription.model');
const Attendance = require('../models/attendance.model');
const logger = require('./logger');
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

// إشعارات اللاعب التلقائية (تذكير الاشتراك + الغياب المتكرر). الخادم على
// Vercel بلا مهام مجدولة، فتُولَّد عند فتح اللاعب للتطبيق (لوحته/إشعاراته) —
// وهو نفس توقيت ظهورها له أصلاً. كل إشعار يحمل meta.alertKey ثابتاً، وفهرس
// فريد عليه يمنع تكراره حتى مع طلبين متزامنين.

const PAYMENT_HINT =
  'تقدر تجدد من التطبيق بإرسال إيصال التحويل — انستا باي أو فودافون كاش على 01010555597.';

const fmt = (dateStr) => {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
};

const SUB_TEXT = {
  exp7: (end, days) => ({
    title: 'اشتراكك يقترب من الانتهاء',
    body: `اشتراكك ينتهي بعد ${days} أيام — موعد التجديد ${fmt(end)}. ${PAYMENT_HINT}`,
  }),
  exp2: (end, days) => ({
    title: 'اشتراكك ينتهي قريباً',
    body: `اشتراكك ينتهي ${days === 1 ? 'غداً' : 'بعد يومين'} — موعد التجديد ${fmt(end)}. ${PAYMENT_HINT}`,
  }),
  exptoday: (end) => ({
    title: 'اشتراكك ينتهي اليوم',
    body: `اليوم آخر يوم في اشتراكك (${fmt(end)}). ${PAYMENT_HINT}`,
  }),
  expired: (end) => ({
    title: 'انتهى اشتراكك',
    body: `انتهى اشتراكك بتاريخ ${fmt(end)}. ${PAYMENT_HINT}`,
  }),
};

// ينشئ الإشعار مرة واحدة لكل alertKey (11000 = سبق إنشاؤه).
const createOnce = async (player, alertKey, doc) => {
  const exists = await Notification.exists({
    recipientType: 'player',
    recipientId: player._id,
    'meta.alertKey': alertKey,
  });
  if (exists) return;
  try {
    await Notification.create({
      recipientType: 'player',
      recipientId: player._id,
      academyId: player.academyId,
      ...doc,
      meta: { ...(doc.meta || {}), alertKey },
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
};

/**
 * يولّد إشعارات اللاعب المستحقة الآن (إن لم تُنشأ من قبل).
 * لا يكسر الطلب الأصلي أبداً — أي خطأ يُسجَّل ويُتجاهل.
 */
const ensurePlayerAlerts = async (player, today) => {
  try {
    const latest = await Subscription.findOne({ playerId: player._id })
      .sort({ endDate: -1 })
      .select('startDate endDate');
    if (!latest) return;

    const endStr = subDateStr(latest.endDate);
    const daysLeft = daysBetween(today, endStr);

    // ── تذكير الاشتراك (أسبوع، يومان، يوم الانتهاء، ثم منتهٍ).
    const stage = subscriptionStage(daysLeft);
    if (stage) {
      const { title, body } = SUB_TEXT[stage](endStr, daysLeft);
      await createOnce(player, `sub_${latest._id}_${stage}`, {
        type: 'SUBSCRIPTION_EXPIRING',
        title,
        body,
        meta: { subscriptionId: latest._id.toString(), endDate: latest.endDate, stage },
      });
    }

    // ── غياب متكرر — للاعب باشتراك نشط فقط.
    if (daysLeft >= 0 && player.attendanceDays?.length) {
      const lookback = parseDateStr(today);
      lookback.setDate(lookback.getDate() - ABSENCE_LOOKBACK_DAYS);
      const dates = await Attendance.find({
        playerId: player._id,
        date: { $gte: toDateStr(lookback) },
      }).distinct('date');

      const joined = player.created_at ? toDateStr(player.created_at) : null;
      const subStart = subDateStr(latest.startDate);
      const notBefore = joined && joined > subStart ? joined : subStart;
      const streak = absenceStreak(player.attendanceDays, new Set(dates), today, notBefore);

      if (streak.count >= ABSENCE_STREAK_THRESHOLD) {
        await createOnce(player, `absence_${streak.start}`, {
          type: 'ABSENCE_ALERT',
          title: 'نلاحظ غيابك عن التمرين',
          body:
            `نلاحظ غياب ${player.fullName} عن آخر ${sessionsText(streak.count)}. ` +
            'ياريت تعرّفونا سبب الغياب من المحادثة مع الأكاديمية، ونتمنى نشوفه في التمرينة الجاية.',
          meta: { count: streak.count, from: streak.start, to: streak.last },
        });
      }
    }
  } catch (err) {
    logger.warn(`[PLAYER-ALERTS] ${player?._id}: ${err.message}`);
  }
};

module.exports = { ensurePlayerAlerts };
