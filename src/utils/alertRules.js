// قواعد التنبيهات المشتركة بين تنبيهات الإدارة (utils/academyAlerts.js)
// وإشعارات اللاعب التلقائية (utils/playerAlerts.js) — حتى تتطابق المواعيد.

const WEEKDAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// عدد التمرينات المتتالية الغائبة التي تُطلق تنبيه الغياب.
const ABSENCE_STREAK_THRESHOLD = 2;

// أقصى مدى نبحث فيه للخلف عن سلسلة غياب.
const ABSENCE_LOOKBACK_DAYS = 35;

// المنتهي يبقى ظاهراً للإدارة هذه المدة بعد الانتهاء.
const EXPIRED_VISIBLE_DAYS = 30;

const pad2 = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDateStr = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
// تاريخ الاشتراك مخزّن كمنتصف ليل UTC من 'YYYY-MM-DD'.
const subDateStr = (d) => new Date(d).toISOString().slice(0, 10);

// فرق الأيام بين تاريخين 'YYYY-MM-DD' (b − a).
const daysBetween = (a, b) =>
  Math.round((parseDateStr(b) - parseDateStr(a)) / (1000 * 60 * 60 * 24));

/**
 * مرحلة تذكير الاشتراك حسب الأيام المتبقية:
 *   3..7  ⇒ 'exp7'     (قبل الانتهاء بأسبوع)
 *   1..2  ⇒ 'exp2'     (قبل الانتهاء بيومين)
 *   0     ⇒ 'exptoday' (يوم الانتهاء)
 *   −1..−30 ⇒ 'expired'
 * كل مرحلة تنبيه مستقل (معرّف مختلف) — فيظهر التذكير في كل مرحلة مرة.
 */
const subscriptionStage = (daysLeft) => {
  if (daysLeft >= 3 && daysLeft <= 7) return 'exp7';
  if (daysLeft >= 1 && daysLeft <= 2) return 'exp2';
  if (daysLeft === 0) return 'exptoday';
  if (daysLeft < 0 && daysLeft >= -EXPIRED_VISIBLE_DAYS) return 'expired';
  return null;
};

/**
 * سلسلة الغياب الحالية: نمشي للخلف من أمس على أيام تدريب اللاعب فقط حتى أول
 * يوم حضور. اليوم نفسه لا يُحسب (قد تكون التمرينة لم تبدأ بعد).
 * [notBefore] 'YYYY-MM-DD' — لا نعدّ قبل تسجيل اللاعب/بداية اشتراكه.
 * يعيد { count, start, last } — start أقدم يوم غياب في السلسلة (يحدد هويتها:
 * سلسلة واحدة = تنبيه واحد مهما طالت).
 */
const absenceStreak = (attendanceDays, presentDates, today, notBefore) => {
  const days = Array.isArray(attendanceDays) ? attendanceDays : [];
  if (!days.length) return { count: 0, start: null, last: null };
  const cur = parseDateStr(today);
  let count = 0;
  let start = null;
  let last = null;
  for (let i = 0; i < ABSENCE_LOOKBACK_DAYS; i++) {
    cur.setDate(cur.getDate() - 1);
    const ds = toDateStr(cur);
    if (notBefore && ds < notBefore) break;
    if (!days.includes(WEEKDAY_AR[cur.getDay()])) continue;
    if (presentDates.has(ds)) break;
    count += 1;
    start = ds;
    if (!last) last = ds;
  }
  return { count, start, last };
};

// "تمرينتين" / "3 تمرينات" / "11 تمرينة".
const sessionsText = (n) => (n === 2 ? 'تمرينتين' : n <= 10 ? `${n} تمرينات` : `${n} تمرينة`);

module.exports = {
  sessionsText,
  WEEKDAY_AR,
  ABSENCE_STREAK_THRESHOLD,
  ABSENCE_LOOKBACK_DAYS,
  EXPIRED_VISIBLE_DAYS,
  toDateStr,
  parseDateStr,
  subDateStr,
  daysBetween,
  subscriptionStage,
  absenceStreak,
};
