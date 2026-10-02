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

const playerSummary = (p) => ({
  id: p._id.toString(),
  fullName: p.fullName,
  playerCode: p.playerCode,
  sport: p.sport,
  image_url: p.image_url,
});

// حالة اشتراك اللاعب وحضوره هذا الشهر — تُعرض في نتيجة المسح مباشرة.
// status: active | expiring (7 أيام أو أقل) | expired | none.
const scanInfo = async (player, date) => {
  const monthStart = date.slice(0, 8) + '01';
  const [latestSub, presentThisMonth] = await Promise.all([
    Subscription.findOne({ playerId: player._id }).sort({ endDate: -1 }).select('endDate'),
    Attendance.countDocuments({ playerId: player._id, date: { $gte: monthStart, $lte: date } }),
  ]);

  let subscription = { status: 'none', endDate: null, daysRemaining: null };
  if (latestSub) {
    const ms = latestSub.endDate.getTime() - Date.now();
    const daysRemaining = ms <= 0 ? 0 : Math.ceil(ms / (1000 * 60 * 60 * 24));
    const status = ms < 0 ? 'expired' : daysRemaining <= 7 ? 'expiring' : 'active';
    subscription = { status, endDate: latestSub.endDate, daysRemaining };
  }

  // الغياب = أيام تدريب اللاعب من أول الشهر حتى اليوم بلا حضور (نفس منطق التقرير).
  const weekdayCounts = weekdayCountsInRange(monthStart, date);
  const days = Array.isArray(player.attendanceDays) ? player.attendanceDays : [];
  const expected = days.reduce((sum, d) => sum + (weekdayCounts[d] || 0), 0);

  return {
    subscription,
    monthAttendance: {
      present: presentThisMonth,
      absent: Math.max(expected - presentThisMonth, 0),
      expected,
    },
  };
};

// ─── POST /attendance ─────────────────────────────────────────────────────────
// مسح واحد = طلب واحد: بحث عن اللاعب + منع التكرار + إنشاء السجل + إرجاع بيانات اللاعب.
const recordAttendance = async (req, res, next) => {
  const { code, playerId, localDate, localTime } = req.body;
  logger.info(`[ATTENDANCE] record request: code="${code ?? ''}" playerId="${playerId ?? ''}"`);

  // 1) العثور على اللاعب (بالكود من الـ QR أو بالمعرّف)
  let player;
  let searchKey = playerId;
  if (playerId) {
    player = await Player.findById(playerId);
  } else {
    const normalized = normalizeCode(code);
    searchKey = normalized;
    logger.info(`[ATTENDANCE] normalized playerCode for search: "${normalized}"`);
    if (!normalized) return next(new AppError('كود اللاعب مطلوب', 400));
    player = await Player.findOne({ playerCode: normalized });
  }

  if (!player || player.isActive === false) {
    logger.warn(`[ATTENDANCE] player NOT FOUND for "${searchKey}"`);
    return next(new AppError('اللاعب غير موجود', 404));
  }
  logger.info(`[ATTENDANCE] player found: ${player.playerCode} - ${player.fullName}`);

  // طلب انضمام لم تتم الموافقة عليه بعد ليس لاعباً في الأكاديمية، فلا يُسجَّل له حضور.
  if (['pending', 'rejected'].includes(player.registrationStatus)) {
    logger.warn(`[ATTENDANCE] blocked — registrationStatus=${player.registrationStatus} for ${player.playerCode}`);
    return next(new AppError('لم تتم الموافقة على طلب انضمام هذا اللاعب بعد', 403));
  }

  // 2) فحص صلاحية النطاق
  if (
    req.user.role !== 'super_admin' &&
    player.academyId.toString() !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية لتسجيل حضور هذا اللاعب', 403));
  }

  const date = (localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate)) ? localDate : serverDateStr();
  const time = (localTime && /^\d{2}:\d{2}$/.test(localTime)) ? localTime : serverTimeStr();

  // 3) محاولة الإنشاء — الفهرس الفريد (playerId, date) هو حارس منع التكرار.
  try {
    const attendance = await Attendance.create({
      playerId: player._id,
      academyId: player.academyId,
      sport: player.sport,
      date,
      time,
      status: 'present',
    });

    logger.info(`Attendance recorded: ${player.playerCode} @ ${date} ${time}`);
    logActivity(req, {
      actionType: 'RECORD_ATTENDANCE', entityType: 'ATTENDANCE',
      entityId: player._id, entityName: player.fullName, academyId: player.academyId,
    });
    // إشعار اللاعب بتسجيل حضوره (fire-and-forget).
    notify({
      recipientType: 'player', recipientId: player._id, academyId: player.academyId,
      type: 'ATTENDANCE_PRESENT', title: 'تم تسجيل حضورك',
      body: `تم تسجيل حضورك بتاريخ ${date} الساعة ${time}`,
      meta: { date, time },
    });
    return sendSuccess(res, {
      data: {
        recorded: true,
        alreadyToday: false,
        player: playerSummary(player),
        attendance,
        ...(await scanInfo(player, date)),
      },
      message: 'تم تسجيل الحضور بنجاح',
      statusCode: 201,
    });
  } catch (err) {
    // مفتاح مكرّر ⇒ اللاعب سُجّل مسبقاً في نفس اليوم
    if (err && err.code === 11000) {
      return sendSuccess(res, {
        data: {
          recorded: false,
          alreadyToday: true,
          player: playerSummary(player),
          ...(await scanInfo(player, date)),
        },
        message: 'تم تسجيل حضور هذا اللاعب مسبقاً اليوم',
      });
    }
    return next(err);
  }
};

// ─── GET /attendance ──────────────────────────────────────────────────────────
// سجل الحضور — مُصفحَّن مع فلاتر (التاريخ، الرياضة، اللاعب). استعلام واحد + populate.
const getAttendance = async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 30));
  const skip = (page - 1) * limit;

  const filter = {};

  // نطاق الأكاديمية إلزامي — super_admin يمرّر academyId، وغيره مُقيَّد بأكاديميته.
  if (req.user.role === 'super_admin') {
    if (!req.query.academyId) {
      return next(new AppError('معرّف الأكاديمية مطلوب', 400));
    }
    filter.academyId = req.query.academyId;
  } else {
    filter.academyId = req.user.academyId;
  }

  // فلتر يوم محدّد، أو نطاق تاريخي (مقارنة نصية صالحة لصيغة YYYY-MM-DD)
  if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
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

  // بحث باسم اللاعب أو كوده في كل السجل (لا في الصفحة المحمّلة فقط).
  // الأرقام وحدها تعني الكود: '123' = Y-0123 بالضبط.
  const term = String(req.query.search || '').trim();
  if (term) {
    const code = normalizeCode(term);
    const isCode = /^Y-\d+$/.test(code);
    const playerIds = await Player.find({
      academyId: filter.academyId,
      ...(isCode
        ? { playerCode: code }
        : { $or: [
          { fullName: new RegExp(escapeRegex(term), 'i') },
          { playerCode: new RegExp(escapeRegex(term), 'i') },
        ] }),
    }).distinct('_id');
    filter.playerId = { $in: playerIds };
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
  // يُسجَّل لهم حضور — يُرجَع مع الصفحة الأولى فقط ودون بحث.
  let absentPlayers;
  if (typeof filter.date === 'string' && page === 1 && !term) {
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

// عدد كل يوم من أيام الأسبوع ضمن نطاق [start, end] شامل الطرفين.
const weekdayCountsInRange = (startStr, endStr) => {
  const counts = {};
  for (const d of WEEKDAY_AR) counts[d] = 0;
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  // حدّ أمان: لا نتجاوز ~370 تكرار (سنة واحدة)
  let guard = 0;
  while (cur <= end && guard < 400) {
    counts[WEEKDAY_AR[cur.getDay()]] += 1;
    cur.setDate(cur.getDate() + 1);
    guard += 1;
  }
  return counts;
};

// ─── GET /attendance/report ───────────────────────────────────────────────────
// تقرير الحضور/الغياب — استعلامان فقط (لاعبون + تجميع الحضور) ثم حساب في الذاكرة.
const getAttendanceReport = async (req, res, next) => {
  // نطاق الأكاديمية — super_admin يمرّر academyId، وغيره مُقيَّد بأكاديميته.
  let academyId;
  if (req.user.role === 'super_admin') {
    if (!req.query.academyId) {
      return next(new AppError('معرّف الأكاديمية مطلوب', 400));
    }
    academyId = req.query.academyId;
  } else {
    academyId = req.user.academyId;
  }

  // الفترة — افتراضياً الشهر الحالي إن لم تُرسل
  const today = serverDateStr();
  const firstOfMonth = today.slice(0, 8) + '01';
  const startDate = (req.query.startDate && /^\d{4}-\d{2}-\d{2}$/.test(req.query.startDate))
    ? req.query.startDate : firstOfMonth;
  const endDate = (req.query.endDate && /^\d{4}-\d{2}-\d{2}$/.test(req.query.endDate))
    ? req.query.endDate : today;

  const sport = (req.query.sport && req.query.sport.trim().length > 0)
    ? req.query.sport.trim() : null;

  // (أ) لاعبو الأكاديمية النشطون
  const playerFilter = { academyId, isActive: true, ...Player.APPROVED_ONLY };
  if (sport) playerFilter.sport = sport;
  const players = await Player.find(playerFilter)
    .select('fullName playerCode sport attendanceDays');

  // (ب) تجميع الحضور خلال الفترة لكل لاعب
  const matchStage = {
    academyId: new mongoose.Types.ObjectId(String(academyId)),
    date: { $gte: startDate, $lte: endDate },
  };
  if (sport) matchStage.sport = sport;
  const agg = await Attendance.aggregate([
    { $match: matchStage },
    { $group: { _id: '$playerId', present: { $sum: 1 } } },
  ]);
  const presentMap = {};
  for (const row of agg) presentMap[row._id.toString()] = row.present;

  // حساب المتوقع/الغياب/نسبة الالتزام في الذاكرة
  const weekdayCounts = weekdayCountsInRange(startDate, endDate);
  let totalPresent = 0;
  let totalAbsent = 0;

  const rows = players.map((p) => {
    const days = Array.isArray(p.attendanceDays) ? p.attendanceDays : [];
    const expected = days.reduce((sum, d) => sum + (weekdayCounts[d] || 0), 0);
    const present = presentMap[p._id.toString()] || 0;
    const absent = Math.max(expected - present, 0);
    const rate = expected > 0
      ? Math.round((present / expected) * 100)
      : (present > 0 ? 100 : 0);
    totalPresent += present;
    totalAbsent += absent;
    return {
      playerId: p._id.toString(),
      playerCode: p.playerCode,
      fullName: p.fullName,
      sport: p.sport,
      attendanceDays: days,
      expected,
      present,
      absent,
      rate,
    };
  });

  return sendSuccess(res, {
    data: {
      startDate,
      endDate,
      sport,
      playersCount: rows.length,
      totalPresent,
      totalAbsent,
      rows,
    },
    message: 'تم جلب تقرير الحضور بنجاح',
  });
};

module.exports = {
  recordAttendance,
  getAttendance,
  getAttendanceReport,
};
