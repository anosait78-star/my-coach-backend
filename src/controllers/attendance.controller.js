const mongoose = require('mongoose');
const Attendance = require('../models/attendance.model');
const Player = require('../models/player.model');
const Subscription = require('../models/subscription.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');
const { notify } = require('../utils/notificationService');
const escapeRegex = require('../utils/escapeRegex');

// أسماء أيام الأسبوع العربية مرتبطة بـ Date.getDay() (0 = الأحد ... 6 = السبت)
// مطابقة تماماً للقيم المخزّنة في player.attendanceDays و SportsConstants.weekDays.
const WEEKDAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const ATTENDANCE_KINDS = ['regular', 'pay_later', 'makeup', 'free'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 1000 * 60 * 60 * 24;

// تطبيع كود اللاعب القادم من الـ QR: يقبل 'PLAYER:Y-0001' أو 'Y-0001'.
// نُزيل المسافات أولاً ثم بادئة PLAYER: (غير حسّاسة لحالة الأحرف) ثم المسافات مجدداً.
// إدخال الكود بالأرقام فقط (أو بحرف صغير): '123' أو 'y-123' → 'Y-0123'.
const normalizeCode = (raw) => {
  if (!raw) return '';
  let v = String(raw).trim();
  v = v.replace(/^PLAYER:/i, '').trim();
  const digits = v.match(/^(?:Y-?)?(\d+)$/i);
  if (digits) return 'Y-' + String(parseInt(digits[1], 10)).padStart(4, '0');
  return v;
};

const pad2 = (n) => String(n).padStart(2, '0');
const serverDateStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const serverTimeStr = () => {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// "اليوم" بتوقيت جهاز المستخدم إن أرسله (localDate)، وإلا بتوقيت السيرفر —
// السيرفر UTC والأكاديمية +2/+3، فالاعتماد على الجهاز يمنع انزياح اليوم ليلاً.
const todayFor = (req) => {
  const local = req.query?.localDate || req.body?.localDate;
  return local && DATE_RE.test(local) ? local : serverDateStr();
};

// تواريخ الاشتراك تُخزَّن من 'YYYY-MM-DD' كمنتصف ليل UTC — نقرؤها بنفس الصيغة.
const dateToStr = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const playerSummary = (p) => ({
  id: p._id.toString(),
  fullName: p.fullName,
  playerCode: p.playerCode,
  sport: p.sport,
  image_url: p.image_url,
});

// نطاق الأكاديمية — super_admin يمرّر academyId، وغيره مُقيَّد بأكاديميته.
const resolveAcademyId = (req) => {
  if (req.user.role === 'super_admin') {
    const id = req.query.academyId;
    if (!id) throw new AppError('معرّف الأكاديمية مطلوب', 400);
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      throw new AppError('معرّف الأكاديمية غير صحيح', 400);
    }
    return id;
  }
  return req.user.academyId;
};

const assertPlayerScope = (req, player, message) => {
  if (
    req.user.role !== 'super_admin' &&
    player.academyId.toString() !== req.user.academyId?.toString()
  ) {
    throw new AppError(message, 403);
  }
};

// ─── قاعدة الاحتساب الموحدة ──────────────────────────────────────────────────
// S = { id, start, end, prevEnd } — نصوص 'YYYY-MM-DD'. prevEnd = نهاية الاشتراك
// الذي قبله (أو null).
//   regular   يُحتسب إن كان داخل [start, end].
//   pay_later يُحتسب للتجديد الذي يلي فترة الانتهاء: date ≤ end و date > prevEnd
//             (أو date ≥ start إن لم يوجد سابق).
//   makeup    يُحتسب للاشتراك الذي سُجِّل عليه (subscriptionId).
//   free      لا يُحتسب أبداً.
const kindOf = (record) => record.kind || 'regular';

const countsFor = (record, S) => {
  const { date } = record;
  switch (kindOf(record)) {
    case 'regular':
      return S.start <= date && date <= S.end;
    case 'pay_later':
      return date <= S.end && (S.prevEnd ? date > S.prevEnd : date >= S.start);
    case 'makeup':
      return Boolean(record.subscriptionId) && record.subscriptionId.toString() === S.id;
    default:
      return false;
  }
};

// أقدم تاريخ قد يُحتاج لاشتراك S (يُضيّق استعلام السجلات).
const lowerBoundOf = (S) => (S.prevEnd && S.prevEnd < S.start ? S.prevEnd : S.start);

// نهاية آخر اشتراك للاعب قبل [sub].
const prevEndOf = async (sub) => {
  const prev = await Subscription.findOne({
    playerId: sub.playerId,
    _id: { $ne: sub._id },
    endDate: { $lt: sub.endDate },
  })
    .sort({ endDate: -1 })
    .select('endDate');
  return prev ? dateToStr(prev.endDate) : null;
};

const periodOf = (sub, prevEnd) => ({
  id: sub._id.toString(),
  start: dateToStr(sub.startDate),
  end: dateToStr(sub.endDate),
  prevEnd,
});

// عدد كل يوم من أيام الأسبوع ضمن نطاق [start, end] شامل الطرفين.
const weekdayCountsInRange = (startStr, endStr) => {
  const counts = {};
  for (const d of WEEKDAY_AR) counts[d] = 0;
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  // حدّ أمان: لا نتجاوز ~400 تكرار (سنة وشهر)
  let guard = 0;
  while (cur <= end && guard < 400) {
    counts[WEEKDAY_AR[cur.getDay()]] += 1;
    cur.setDate(cur.getDate() + 1);
    guard += 1;
  }
  return counts;
};

// أيام التدريب المتوقعة للاعب (حسب attendanceDays) في [start, end].
const expectedInRange = (days, start, end) => {
  if (!start || !end || end < start) return 0;
  const counts = weekdayCountsInRange(start, end);
  return (Array.isArray(days) ? days : []).reduce((sum, d) => sum + (counts[d] || 0), 0);
};

const daysRemainingOf = (endDate) => {
  const ms = new Date(endDate).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
};

// إحصائيات لاعب في اشتراك [sub] (نشط: حتى اليوم، منتهٍ: كامل الفترة).
// daysRemaining إضافة لهذا التطبيق: نتيجة المسح تُظهر "قرب على الانتهاء".
const subscriptionStats = async (player, sub, today) => {
  if (!sub) {
    return {
      status: 'none', subscription: null,
      present: 0, absent: 0, expected: 0, expectedTotal: 0, daysRemaining: null,
    };
  }
  const S = periodOf(sub, await prevEndOf(sub));
  const active = new Date(sub.endDate) >= new Date();
  const countUntil = active && today < S.end ? today : S.end;

  const records = await Attendance.find({
    playerId: player._id,
    $or: [
      { date: { $gte: lowerBoundOf(S), $lte: S.end } },
      { subscriptionId: sub._id },
    ],
  }).select('date kind subscriptionId');

  const present = records.filter((r) => countsFor(r, S)).length;
  const expected = expectedInRange(player.attendanceDays, S.start, countUntil);
  const expectedTotal = expectedInRange(player.attendanceDays, S.start, S.end);

  return {
    status: active ? 'active' : 'expired',
    subscription: {
      id: S.id,
      type: sub.type,
      startDate: sub.startDate,
      endDate: sub.endDate,
    },
    present,
    absent: Math.max(expected - present, 0),
    expected,
    expectedTotal,
    daysRemaining: active ? daysRemainingOf(sub.endDate) : 0,
  };
};

const latestSubscriptionOf = (playerId) =>
  Subscription.findOne({ playerId }).sort({ endDate: -1 });

const KIND_SUFFIX = {
  pay_later: ' (الدفع لاحقاً)',
  makeup: ' (تعويض غياب سابق)',
  free: ' (حصة مجانية)',
};

// ─── POST /attendance ─────────────────────────────────────────────────────────
// مسح واحد = طلب واحد: بحث عن اللاعب + منع التكرار + إنشاء السجل + الإحصائيات.
// اشتراك منتهٍ بلا [mode] ⇒ لا تسجيل؛ الواجهة تعرض الخيارات ثم تعيد الإرسال مع
// mode = pay_later | makeup | free.
const recordAttendance = async (req, res, next) => {
  const { code, playerId, localDate, localTime } = req.body;
  // allowExpired قديم ≡ pay_later.
  const mode = req.body.mode || (req.body.allowExpired === true ? 'pay_later' : null);
  logger.info(`[ATTENDANCE] record request: code="${code ?? ''}" playerId="${playerId ?? ''}" mode="${mode ?? ''}"`);

  // 1) العثور على اللاعب (بالكود من الـ QR أو بالمعرّف)
  let player;
  let searchKey = playerId;
  if (playerId) {
    player = await Player.findById(playerId);
  } else {
    const normalized = normalizeCode(code);
    searchKey = normalized;
    if (!normalized) return next(new AppError('كود اللاعب مطلوب', 400));
    player = await Player.findOne({ playerCode: normalized });
  }

  if (!player || player.isActive === false) {
    logger.warn(`[ATTENDANCE] player NOT FOUND for "${searchKey}"`);
    return next(new AppError('اللاعب غير موجود', 404));
  }

  // طلب انضمام لم تتم الموافقة عليه بعد ليس لاعباً في الأكاديمية، فلا يُسجَّل له حضور.
  if (['pending', 'rejected'].includes(player.registrationStatus)) {
    return next(new AppError('لم تتم الموافقة على طلب انضمام هذا اللاعب بعد', 403));
  }

  // 2) فحص صلاحية النطاق
  assertPlayerScope(req, player, 'ليس لديك صلاحية لتسجيل حضور هذا اللاعب');

  const date = (localDate && DATE_RE.test(localDate)) ? localDate : serverDateStr();
  const time = (localTime && /^\d{2}:\d{2}$/.test(localTime)) ? localTime : serverTimeStr();

  // 3) آخر اشتراك
  const latest = await latestSubscriptionOf(player._id);
  const subscriptionExpired = !latest || latest.endDate < new Date();

  const alreadyTodayResponse = async () => sendSuccess(res, {
    data: {
      recorded: false,
      alreadyToday: true,
      player: playerSummary(player),
      stats: await subscriptionStats(player, latest, date),
    },
    message: 'تم تسجيل حضور هذا اللاعب مسبقاً اليوم',
  });

  // 4) منتهٍ بلا اختيار ⇒ لا تسجيل (إلا لو سُجِّل اليوم أصلاً).
  if (subscriptionExpired && !mode) {
    if (await Attendance.exists({ playerId: player._id, date })) {
      return alreadyTodayResponse();
    }
    return sendSuccess(res, {
      data: {
        recorded: false,
        alreadyToday: false,
        subscriptionExpired: true,
        player: playerSummary(player),
        stats: await subscriptionStats(player, latest, date),
      },
      message: 'اشتراك اللاعب منتهي',
    });
  }

  // mode يُتجاهل لو الاشتراك نشط.
  const kind = subscriptionExpired ? mode : 'regular';
  if (!ATTENDANCE_KINDS.includes(kind)) {
    return next(new AppError('نوع الحضور غير صحيح', 400));
  }
  if (kind === 'makeup' && !latest) {
    return next(new AppError('لا يوجد اشتراك سابق لتعويض الغياب فيه', 400));
  }

  // 5) الإنشاء — الفهرس الفريد (playerId, date) هو حارس منع التكرار.
  try {
    const attendance = await Attendance.create({
      playerId: player._id,
      academyId: player.academyId,
      sport: player.sport,
      date,
      time,
      status: 'present',
      kind,
      subscriptionId: kind === 'makeup' ? latest._id : null,
    });

    logger.info(`Attendance recorded: ${player.playerCode} @ ${date} ${time} (${kind})`);
    logActivity(req, {
      actionType: 'RECORD_ATTENDANCE', entityType: 'ATTENDANCE',
      entityId: player._id, entityName: player.fullName, academyId: player.academyId,
    });
    notify({
      recipientType: 'player', recipientId: player._id, academyId: player.academyId,
      type: 'ATTENDANCE_PRESENT', title: 'تم تسجيل حضورك',
      body: `تم تسجيل حضورك بتاريخ ${date} الساعة ${time}${KIND_SUFFIX[kind] || ''}`,
      meta: { date, time, kind },
    });
    return sendSuccess(res, {
      data: {
        recorded: true,
        alreadyToday: false,
        kind,
        player: playerSummary(player),
        attendance,
        stats: await subscriptionStats(player, latest, date),
      },
      message: 'تم تسجيل الحضور بنجاح',
      statusCode: 201,
    });
  } catch (err) {
    // مفتاح مكرّر ⇒ اللاعب سُجّل مسبقاً في نفس اليوم
    if (err && err.code === 11000) return alreadyTodayResponse();
    return next(err);
  }
};

// ─── GET /attendance ──────────────────────────────────────────────────────────
// سجل الحضور — مُصفحَّن مع فلاتر (التاريخ، الرياضة، اللاعب). استعلام واحد + populate.
const getAttendance = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 30));
  const skip = (page - 1) * limit;

  const filter = { academyId: resolveAcademyId(req) };

  // فلتر يوم محدّد، أو نطاق تاريخي (مقارنة نصية صالحة لصيغة YYYY-MM-DD)
  if (req.query.date && DATE_RE.test(req.query.date)) {
    filter.date = req.query.date;
  } else if (req.query.startDate || req.query.endDate) {
    filter.date = {};
    if (req.query.startDate) filter.date.$gte = req.query.startDate;
    if (req.query.endDate) filter.date.$lte = req.query.endDate;
  }

  if (req.query.sport && req.query.sport.trim().length > 0) {
    filter.sport = req.query.sport.trim();
  }
  if (req.query.playerId) {
    filter.playerId = req.query.playerId;
  }

  const [records, total] = await Promise.all([
    Attendance.find(filter)
      .populate('playerId', 'fullName playerCode image_url')
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit),
    Attendance.countDocuments(filter),
  ]);

  // ملخص يوم محدد: اللاعبون الذين لهم تمرين هذا اليوم (حسب أيام حضورهم) ولم
  // يُسجَّل لهم حضور — مع الصفحة الأولى فقط، وليس عند تصفّح لاعب واحد.
  let absentPlayers;
  if (typeof filter.date === 'string' && page === 1 && !filter.playerId) {
    const [y, m, d] = filter.date.split('-').map(Number);
    const weekday = WEEKDAY_AR[new Date(y, m - 1, d).getDay()];
    const scheduledFilter = {
      academyId: filter.academyId,
      isActive: true,
      ...Player.APPROVED_ONLY,
      attendanceDays: weekday,
    };
    if (filter.sport) scheduledFilter.sport = filter.sport;
    const [scheduled, presentIds] = await Promise.all([
      Player.find(scheduledFilter).select('fullName playerCode sport image_url').sort({ fullName: 1 }),
      Attendance.find({ academyId: filter.academyId, date: filter.date }).distinct('playerId'),
    ]);
    const present = new Set(presentIds.map(String));
    absentPlayers = scheduled
      .filter((p) => !present.has(p._id.toString()))
      .map(playerSummary);
  }

  return res.status(200).json({
    success: true,
    message: 'تم جلب سجل الحضور بنجاح',
    data: records,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
      ...(absentPlayers ? { absentPlayers } : {}),
    },
  });
};

// ─── GET /attendance/report ───────────────────────────────────────────────────
// تقرير الحضور والغياب على أساس اشتراك كل لاعب (من بدايته حتى اليوم) — لا على
// الشهر الميلادي. أربعة استعلامات فقط ثم حساب في الذاكرة.
// ?subscription=active (نشطون فقط) | أي قيمة أخرى = الكل (المنتهي يظهر بلا أرقام).
const getAttendanceReport = async (req, res) => {
  const academyId = resolveAcademyId(req);
  const academyObjectId = new mongoose.Types.ObjectId(String(academyId));
  const sport = (req.query.sport && req.query.sport.trim().length > 0)
    ? req.query.sport.trim() : null;
  const subscriptionFilter = req.query.subscription === 'active' ? 'active' : 'all';
  const today = todayFor(req);
  const now = new Date();

  // (أ) الاشتراكات النشطة — أحدثها لكل لاعب.
  const activeSubs = await Subscription.find({ academyId: academyObjectId, endDate: { $gte: now } })
    .sort({ endDate: -1 });
  const activeSubMap = new Map();
  for (const s of activeSubs) {
    const key = s.playerId.toString();
    if (!activeSubMap.has(key)) activeSubMap.set(key, s);
  }

  // (ب) اللاعبون.
  const playerFilter = { academyId: academyObjectId, isActive: true, ...Player.APPROVED_ONLY };
  if (sport) playerFilter.sport = sport;
  if (subscriptionFilter === 'active') {
    playerFilter._id = { $in: [...activeSubMap.keys()] };
  }
  const players = await Player.find(playerFilter)
    .select('fullName playerCode sport attendanceDays')
    .sort({ fullName: 1 });

  const activePlayers = players.filter((p) => activeSubMap.has(p._id.toString()));
  const activeIds = activePlayers.map((p) => p._id);

  // (ج) نهاية الاشتراك السابق لكل لاعب نشط ⇒ فترة الاحتساب.
  const allSubs = activeIds.length
    ? await Subscription.find({ playerId: { $in: activeIds } }).select('playerId endDate')
    : [];
  const periods = new Map();
  let minStart = null;
  for (const p of activePlayers) {
    const key = p._id.toString();
    const sub = activeSubMap.get(key);
    let prevEnd = null;
    for (const s of allSubs) {
      if (s.playerId.toString() !== key || s._id.equals(sub._id)) continue;
      if (s.endDate < sub.endDate) {
        const end = dateToStr(s.endDate);
        if (!prevEnd || end > prevEnd) prevEnd = end;
      }
    }
    const S = periodOf(sub, prevEnd);
    periods.set(key, S);
    const lb = lowerBoundOf(S);
    if (!minStart || lb < minStart) minStart = lb;
  }

  // (د) سجلات الحضور مرة واحدة ثم تجميع لكل لاعب.
  const records = activeIds.length
    ? await Attendance.find({
      academyId: academyObjectId,
      playerId: { $in: activeIds },
      date: { $gte: minStart },
    }).select('playerId date kind subscriptionId')
    : [];
  const recordsByPlayer = new Map();
  for (const r of records) {
    const key = r.playerId.toString();
    if (!recordsByPlayer.has(key)) recordsByPlayer.set(key, []);
    recordsByPlayer.get(key).push(r);
  }

  let totalPresent = 0;
  let totalAbsent = 0;
  const rows = players.map((p) => {
    const key = p._id.toString();
    const base = {
      playerId: key,
      playerCode: p.playerCode,
      fullName: p.fullName,
      sport: p.sport,
      attendanceDays: p.attendanceDays || [],
    };
    const S = periods.get(key);
    if (!S) {
      return {
        ...base,
        subscriptionStatus: 'expired',
        subscriptionStart: null,
        subscriptionEnd: null,
        expected: 0, expectedTotal: 0, expectedThisMonth: 0,
        present: 0, absent: 0, rate: 0,
      };
    }
    const countUntil = today < S.end ? today : S.end;
    const present = (recordsByPlayer.get(key) || []).filter((r) => countsFor(r, S)).length;
    const expected = expectedInRange(p.attendanceDays, S.start, countUntil);
    const expectedTotal = expectedInRange(p.attendanceDays, S.start, S.end);
    const absent = Math.max(expected - present, 0);
    const rate = expected > 0
      ? Math.min(100, Math.round((present / expected) * 100))
      : (present > 0 ? 100 : 0);
    totalPresent += present;
    totalAbsent += absent;
    return {
      ...base,
      subscriptionStatus: 'active',
      subscriptionStart: S.start,
      subscriptionEnd: S.end,
      expected,
      expectedTotal,
      expectedThisMonth: expectedTotal, // توافق رجعي مع واجهات قديمة
      present,
      absent,
      rate,
    };
  });

  return sendSuccess(res, {
    data: {
      basis: 'subscription',
      startDate: minStart || today,
      endDate: today,
      sport,
      subscription: subscriptionFilter,
      playersCount: rows.length,
      activeCount: activePlayers.length,
      totalPresent,
      totalAbsent,
      rows,
    },
    message: 'تم جلب تقرير الحضور بنجاح',
  });
};

// ─── GET /attendance/players?search=&sport= ──────────────────────────────────
// بحث لاعب لسجل الحضور (اسم أو كود). الأرقام وحدها تطابق الكود بالضبط أولاً.
const searchAttendancePlayers = async (req, res) => {
  const term = String(req.query.search || '').trim();
  if (!term) return sendSuccess(res, { data: [], message: 'لا يوجد بحث' });

  const filter = {
    academyId: resolveAcademyId(req),
    isActive: true,
    ...Player.APPROVED_ONLY,
  };
  if (req.query.sport && req.query.sport.trim().length > 0) {
    filter.sport = req.query.sport.trim();
  }
  const regex = new RegExp(escapeRegex(term), 'i');
  const code = normalizeCode(term);
  filter.$or = [{ fullName: regex }, { playerCode: regex }, { playerCode: code }];

  const players = await Player.find(filter)
    .select('fullName playerCode sport image_url')
    .sort({ fullName: 1 })
    .limit(30);

  // المطابقة التامة للكود أولاً.
  players.sort((a, b) => (b.playerCode === code) - (a.playerCode === code));
  return sendSuccess(res, { data: players.map(playerSummary), message: 'تم البحث بنجاح' });
};

// ─── GET /attendance/player/:id/summary ──────────────────────────────────────
// ملخص حضور لاعب في اشتراكه الأخير (نشط: منذ بدايته، منتهٍ: الاشتراك السابق).
const getPlayerAttendanceSummary = async (req, res, next) => {
  const player = await Player.findById(req.params.id)
    .select('fullName playerCode sport image_url academyId attendanceDays');
  if (!player) return next(new AppError('اللاعب غير موجود', 404));
  assertPlayerScope(req, player, 'ليس لديك صلاحية للوصول إلى هذا اللاعب');

  const latest = await latestSubscriptionOf(player._id);
  return sendSuccess(res, {
    data: {
      player: playerSummary(player),
      stats: await subscriptionStats(player, latest, todayFor(req)),
    },
    message: 'تم جلب ملخص الحضور بنجاح',
  });
};

// ─── DELETE /attendance/:id ──────────────────────────────────────────────────
const deleteAttendance = async (req, res, next) => {
  const record = await Attendance.findById(req.params.id).populate('playerId', 'fullName');
  if (!record) return next(new AppError('سجل الحضور غير موجود', 404));
  if (
    req.user.role !== 'super_admin' &&
    record.academyId.toString() !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية لحذف هذا السجل', 403));
  }

  await record.deleteOne();

  logger.info(`Attendance deleted: ${record._id} (${record.date})`);
  logActivity(req, {
    actionType: 'DELETE_ATTENDANCE', entityType: 'ATTENDANCE',
    entityId: record._id, entityName: record.playerId?.fullName || '',
    academyId: record.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف سجل الحضور' });
};

module.exports = {
  recordAttendance,
  getAttendance,
  getAttendanceReport,
  searchAttendancePlayers,
  getPlayerAttendanceSummary,
  deleteAttendance,
  // مُصدَّرة لبوابة اللاعب (عدد الحضور على أساس الاشتراك).
  subscriptionStats,
  todayFor,
};
