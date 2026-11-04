const mongoose = require('mongoose');
const Tournament = require('../models/tournament.model');
const Participant = require('../models/tournamentParticipant.model');
const Fixture = require('../models/tournamentFixture.model');
const Player = require('../models/player.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { notify } = require('../utils/notificationService');
const E = require('../utils/tournamentEngine');

// ─── الصلاحيات ────────────────────────────────────────────────────────────────
// الحساب الرئيسي (super_admin) يرى ويدير كل البطولات.
// حساب الفرع يرى بطولات فرعه، ويدير فقط البطولات الخاصة بفرعه وحده
// (البطولة المشتركة بين عدة فروع يديرها الحساب الرئيسي) — نفس قاعدة العروض.
const own = (req) => req.user.academyId?.toString();
const canView = (req, t) =>
  req.user.role === 'super_admin' || t.academyIds.some((id) => id.toString() === own(req));
const canManage = (req, t) =>
  req.user.role === 'super_admin' || (t.academyIds.length === 1 && t.academyIds[0].toString() === own(req));

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v));

const loadTournament = async (req, { manage = false } = {}) => {
  const t = isId(req.params.id) ? await Tournament.findById(req.params.id) : null;
  if (!t || !canView(req, t)) throw new AppError('البطولة غير موجودة', 404);
  if (manage && !canManage(req, t)) throw new AppError('ليس لديك صلاحية لتعديل هذه البطولة', 403);
  return t;
};

const assertDraft = (t) => {
  if (t.status !== 'draft') {
    throw new AppError('لا يمكن تعديل هذا بعد توليد جدول المباريات. احذف الجدول أولاً.', 400);
  }
};

// ─── تحويلات لمحرك البطولات ───────────────────────────────────────────────────
const sid = (v) => (v ? v.toString() : null);
const toEngine = (f) => ({
  aId: sid(f.aId),
  bId: sid(f.bId),
  status: f.status,
  forA: f.scoreA ?? 0,
  forB: f.scoreB ?? 0,
  outcome: !f.winnerId ? 'draw' : sid(f.winnerId) === sid(f.aId) ? 'a' : 'b',
});

const standingsFor = (t, participants, fixtures) => {
  if (t.format === 'league') {
    return [{
      groupIndex: null,
      rows: E.computeStandings(
        participants.map((p) => sid(p._id)),
        fixtures.filter((f) => f.stage === 'league').map(toEngine),
        t.league
      ),
    }];
  }
  if (t.format === 'groups_knockout') {
    const groups = [...new Set(participants.map((p) => p.groupIndex).filter((g) => g !== null && g !== undefined))]
      .sort((a, b) => a - b);
    return groups.map((g) => ({
      groupIndex: g,
      rows: E.computeStandings(
        participants.filter((p) => p.groupIndex === g).map((p) => sid(p._id)),
        fixtures.filter((f) => f.stage === 'group' && f.groupIndex === g).map(toEngine),
        t.league
      ),
    }));
  }
  return [];
};

const STAGE_ORDER = { league: 0, group: 1, knockout: 2 };

const buildDetail = async (t, { forPlayer = null } = {}) => {
  const [participants, fixtures] = await Promise.all([
    Participant.find({ tournamentId: t._id }).sort({ seed: 1, createdAt: 1 }),
    Fixture.find({ tournamentId: t._id }),
  ]);
  fixtures.sort((a, b) =>
    STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] ||
    (a.groupIndex ?? 0) - (b.groupIndex ?? 0) ||
    a.round - b.round ||
    a.matchNo - b.matchNo
  );
  const playerIds = [...new Set(participants.flatMap((p) => p.playerIds.map(String)))];
  const players = await Player.find({ _id: { $in: playerIds } }).select(
    forPlayer ? 'fullName image_url' : 'fullName image_url playerCode academyId'
  );
  const myParticipant = forPlayer
    ? participants.find((p) => p.playerIds.some((id) => id.toString() === forPlayer.toString()))
    : null;
  return {
    tournament: t.toJSON(),
    participants: participants.map((p) => p.toJSON()),
    players: players.map((p) => p.toJSON()),
    fixtures: fixtures.map((f) => f.toJSON()),
    standings: standingsFor(t, participants, fixtures),
    myParticipantId: myParticipant ? myParticipant._id.toString() : null,
  };
};

// ─── إشعارات ──────────────────────────────────────────────────────────────────
const notifyParticipants = async (participants, { type, title, body, meta }) => {
  const ids = [...new Set(participants.flatMap((p) => p.playerIds.map(String)))];
  if (!ids.length) return;
  const players = await Player.find({ _id: { $in: ids } }).select('_id academyId');
  for (const p of players) {
    notify({ recipientType: 'player', recipientId: p._id, academyId: p.academyId, type, title, body, meta });
  }
};

// ─── حقول البطولة ─────────────────────────────────────────────────────────────
// SETTINGS تُعدَّل في مرحلة الإعداد فقط، ALWAYS في أي وقت.
const SETTINGS = ['participantType', 'format', 'drawMode', 'scoring', 'league', 'groups', 'knockout', 'sport', 'ageGroup'];
const ALWAYS = ['name', 'notes', 'startDate', 'endDate', 'visibleToPlayers'];
const NESTED = new Set(['scoring', 'league', 'groups', 'knockout']);

const pick = (src, keys) => Object.fromEntries(keys.filter((k) => src[k] !== undefined).map((k) => [k, src[k]]));

const resolveAcademyIds = (req) => {
  if (req.user.role !== 'super_admin') return [req.user.academyId];
  const ids = Array.isArray(req.body.academyIds) ? req.body.academyIds : [];
  if (!ids.length) throw new AppError('يجب اختيار فرع واحد على الأقل', 400);
  if (!ids.every(isId)) throw new AppError('معرّف الفرع غير صحيح', 400);
  return [...new Set(ids.map(String))];
};

const validateSettings = (t) => {
  if (t.format === 'groups_knockout' && t.groups.count < 2) {
    throw new AppError('نظام المجموعات يحتاج مجموعتين على الأقل', 400);
  }
  if (t.scoring.mode === 'sets' && t.scoring.bestOf % 2 === 0) {
    throw new AppError('عدد الأشواط يجب أن يكون فردياً (أفضل 1 أو 3 أو 5…)', 400);
  }
  if (t.scoring.maxPointsPerSet && t.scoring.maxPointsPerSet < t.scoring.pointsPerSet) {
    throw new AppError('الحد الأقصى للشوط يجب أن يكون أكبر من نقاط الشوط', 400);
  }
};

// ─── GET /tournaments ─────────────────────────────────────────────────────────
const listTournaments = async (req, res) => {
  const filter = {};
  if (req.user.role === 'super_admin') {
    if (req.query.academyId) {
      if (!isId(req.query.academyId)) throw new AppError('معرّف الفرع غير صحيح', 400);
      filter.academyIds = req.query.academyId;
    }
  } else {
    filter.academyIds = req.user.academyId;
  }
  if (req.query.status) filter.status = String(req.query.status);

  const items = await Tournament.find(filter).sort({ createdAt: -1 }).limit(200);
  const counts = await Participant.aggregate([
    { $match: { tournamentId: { $in: items.map((t) => t._id) } } },
    { $group: { _id: '$tournamentId', n: { $sum: 1 } } },
  ]);
  const byId = Object.fromEntries(counts.map((c) => [c._id.toString(), c.n]));
  return sendSuccess(res, {
    data: items.map((t) => ({
      ...t.toJSON(),
      participantsCount: byId[t._id.toString()] || 0,
      canManage: canManage(req, t),
    })),
    message: 'تم جلب البطولات بنجاح',
  });
};

// ─── GET /tournaments/:id ─────────────────────────────────────────────────────
const getTournament = async (req, res) => {
  const t = await loadTournament(req);
  const detail = await buildDetail(t);
  return sendSuccess(res, { data: { ...detail, canManage: canManage(req, t) }, message: 'تم جلب البطولة بنجاح' });
};

// ─── POST /tournaments ────────────────────────────────────────────────────────
const createTournament = async (req, res) => {
  const t = new Tournament({
    ...pick(req.body, [...SETTINGS, ...ALWAYS]),
    academyIds: resolveAcademyIds(req),
    status: 'draft',
    createdBy: req.user._id,
  });
  validateSettings(t);
  await t.save();
  return sendSuccess(res, { data: t.toJSON(), message: 'تم إنشاء البطولة بنجاح', statusCode: 201 });
};

// ─── PUT /tournaments/:id ─────────────────────────────────────────────────────
const updateTournament = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  const settings = pick(req.body, SETTINGS);
  if (Object.keys(settings).length || req.body.academyIds !== undefined) assertDraft(t);

  if (settings.participantType && settings.participantType !== t.participantType) {
    const n = await Participant.countDocuments({ tournamentId: t._id });
    if (n) throw new AppError('احذف المشاركين أولاً قبل تغيير نوع المشاركة', 400);
  }
  // الإعدادات المتداخلة تُدمج حتى لا يمسح تعديل حقل واحد باقي الحقول.
  for (const [k, v] of Object.entries(settings)) {
    if (NESTED.has(k) && v && typeof v === 'object') {
      for (const [sub, val] of Object.entries(v)) t.set(`${k}.${sub}`, val);
    } else {
      t.set(k, v);
    }
  }
  t.set(pick(req.body, ALWAYS));
  if (req.body.academyIds !== undefined && req.user.role === 'super_admin') t.academyIds = resolveAcademyIds(req);
  validateSettings(t);
  await t.save();
  return sendSuccess(res, { data: t.toJSON(), message: 'تم تحديث البطولة بنجاح' });
};

// ─── DELETE /tournaments/:id ──────────────────────────────────────────────────
const deleteTournament = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  await Promise.all([
    Fixture.deleteMany({ tournamentId: t._id }),
    Participant.deleteMany({ tournamentId: t._id }),
  ]);
  await t.deleteOne();
  return sendSuccess(res, { message: 'تم حذف البطولة بنجاح' });
};

// ─── المشاركون ────────────────────────────────────────────────────────────────
const validatePlayers = async (t, playerIds, exceptParticipantId = null) => {
  if (!Array.isArray(playerIds) || !playerIds.length) throw new AppError('يجب اختيار لاعب واحد على الأقل', 400);
  if (!playerIds.every(isId)) throw new AppError('معرّف اللاعب غير صحيح', 400);
  const ids = [...new Set(playerIds.map(String))];
  if (t.participantType === 'individual' && ids.length !== 1) {
    throw new AppError('في البطولات الفردية كل مشارك لاعب واحد فقط', 400);
  }
  const players = await Player.find({
    _id: { $in: ids },
    academyId: { $in: t.academyIds },
    isActive: true,
    ...Player.APPROVED_ONLY,
  }).select('fullName');
  if (players.length !== ids.length) throw new AppError('بعض اللاعبين غير موجودين أو ليسوا من فروع البطولة', 400);

  const clash = await Participant.findOne({
    tournamentId: t._id,
    playerIds: { $in: ids },
    ...(exceptParticipantId ? { _id: { $ne: exceptParticipantId } } : {}),
  });
  if (clash) throw new AppError(`يوجد لاعب مسجّل بالفعل في "${clash.name}"`, 400);
  return { ids, players };
};

const participantFields = async (t, body, existing = null) => {
  const playerIds = body.playerIds ?? existing?.playerIds.map(String);
  const { ids, players } = await validatePlayers(t, playerIds, existing?._id);
  let name = (body.name ?? existing?.name ?? '').toString().trim();
  if (t.participantType === 'individual') name = players[0].fullName;
  if (!name) throw new AppError('اسم الفريق مطلوب', 400);
  if (name.length > 100) throw new AppError('الاسم لا يمكن أن يتجاوز 100 حرف', 400);
  const captainId = body.captainId !== undefined ? body.captainId : existing?.captainId;
  if (captainId && !ids.includes(String(captainId))) throw new AppError('الكابتن يجب أن يكون من لاعبي الفريق', 400);
  return { name, playerIds: ids, captainId: t.participantType === 'team' ? captainId || null : null };
};

const addParticipant = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  assertDraft(t);
  const fields = await participantFields(t, req.body);
  const last = await Participant.findOne({ tournamentId: t._id }).sort({ seed: -1 });
  const p = await Participant.create({ ...fields, tournamentId: t._id, seed: (last?.seed || 0) + 1 });
  return sendSuccess(res, { data: p.toJSON(), message: 'تمت إضافة المشارك بنجاح', statusCode: 201 });
};

const findParticipant = async (t, id) => {
  const p = isId(id) ? await Participant.findOne({ _id: id, tournamentId: t._id }) : null;
  if (!p) throw new AppError('المشارك غير موجود', 404);
  return p;
};

const updateParticipant = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  const p = await findParticipant(t, req.params.participantId);
  // بعد بدء البطولة يُسمح فقط بتعديل اسم الفريق والكابتن، لا تغيير اللاعبين.
  if (req.body.playerIds !== undefined) assertDraft(t);
  p.set(await participantFields(t, req.body, p));
  await p.save();
  return sendSuccess(res, { data: p.toJSON(), message: 'تم تحديث المشارك بنجاح' });
};

const removeParticipant = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  assertDraft(t);
  const p = await findParticipant(t, req.params.participantId);
  await p.deleteOne();
  return sendSuccess(res, { message: 'تم حذف المشارك بنجاح' });
};

// PUT /tournaments/:id/participants/order — ترتيب القرعة الموجّهة (الأول = المصنف 1).
const orderParticipants = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  assertDraft(t);
  const order = (Array.isArray(req.body.order) ? req.body.order : []).map(String);
  const all = await Participant.find({ tournamentId: t._id });
  const allIds = new Set(all.map((p) => p._id.toString()));
  if (order.length !== all.length || new Set(order).size !== order.length || !order.every((id) => allIds.has(id))) {
    throw new AppError('الترتيب يجب أن يشمل كل المشاركين مرة واحدة', 400);
  }
  if (order.length) {
    await Participant.bulkWrite(order.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { seed: i + 1 } } })));
  }
  return sendSuccess(res, { message: 'تم حفظ ترتيب المشاركين' });
};

// ─── توليد الجدول ─────────────────────────────────────────────────────────────
const knockoutDocs = (t, ids) =>
  E.knockoutBracket(ids).map((f) => ({ ...f, tournamentId: t._id, stage: 'knockout' }));

const countPlayed = (t) => Fixture.countDocuments({ tournamentId: t._id, status: 'played' });

const generateFixtures = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  if (await countPlayed(t)) throw new AppError('لا يمكن إعادة توليد الجدول بعد تسجيل نتائج. امسح النتائج أولاً.', 400);

  const parts = await Participant.find({ tournamentId: t._id }).sort({ seed: 1, createdAt: 1 });
  if (parts.length < 2) throw new AppError('يجب إضافة مشاركين اثنين على الأقل', 400);
  const order = E.orderForDraw(parts.map((p) => ({ id: p._id.toString(), seed: p.seed })), t.drawMode);
  const rr = { doubleRound: !!t.league.doubleRound };

  let docs = [];
  const groupOf = new Map();
  if (t.format === 'league') {
    docs = E.roundRobin(order, rr).map((f) => ({ ...f, tournamentId: t._id, stage: 'league' }));
  } else if (t.format === 'knockout') {
    docs = knockoutDocs(t, order);
  } else {
    const groups = E.splitGroups(order, t.groups.count);
    const smallest = Math.min(...groups.map((g) => g.length));
    if (t.groups.qualifiersPerGroup >= smallest) {
      throw new AppError(`عدد المتأهلين من كل مجموعة يجب أن يكون أقل من ${smallest}`, 400);
    }
    groups.forEach((g, gi) => {
      g.forEach((id) => groupOf.set(id, gi));
      docs.push(...E.roundRobin(g, rr).map((f) => ({ ...f, tournamentId: t._id, stage: 'group', groupIndex: gi })));
    });
  }

  await Fixture.deleteMany({ tournamentId: t._id });
  await Fixture.insertMany(docs);
  await Participant.bulkWrite(parts.map((p) => {
    const id = p._id.toString();
    return { updateOne: { filter: { _id: p._id }, update: { groupIndex: groupOf.has(id) ? groupOf.get(id) : null } } };
  }));
  t.status = 'running';
  await t.save();

  if (t.visibleToPlayers) {
    notifyParticipants(parts, {
      type: 'TOURNAMENT_SCHEDULED',
      title: `جدول بطولة ${t.name}`,
      body: 'تم نشر جدول المباريات — اطّلع على مبارياتك',
      meta: { tournamentId: t._id.toString() },
    }).catch(() => {});
  }
  const detail = await buildDetail(t);
  return sendSuccess(res, { data: detail, message: 'تم توليد جدول المباريات بنجاح' });
};

// DELETE /tournaments/:id/fixtures — حذف الجدول والرجوع لمرحلة الإعداد.
const resetFixtures = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  if (await countPlayed(t)) throw new AppError('امسح نتائج المباريات أولاً قبل حذف الجدول', 400);
  await Fixture.deleteMany({ tournamentId: t._id });
  await Participant.updateMany({ tournamentId: t._id }, { groupIndex: null });
  t.status = 'draft';
  await t.save();
  return sendSuccess(res, { message: 'تم حذف الجدول — البطولة الآن في مرحلة الإعداد' });
};

// ─── تعديل مباراة (الموعد / الطرفين) ──────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const findFixture = async (t, id) => {
  const f = isId(id) ? await Fixture.findOne({ _id: id, tournamentId: t._id }) : null;
  if (!f) throw new AppError('المباراة غير موجودة', 404);
  return f;
};

const updateFixture = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  const f = await findFixture(t, req.params.fixtureId);
  const { date, time, location, aId, bId } = req.body;
  if (date !== undefined) {
    if (date !== null && !DATE_RE.test(date)) throw new AppError('صيغة التاريخ غير صحيحة', 400);
    f.date = date;
  }
  if (time !== undefined) {
    if (time !== null && !TIME_RE.test(time)) throw new AppError('صيغة الوقت غير صحيحة', 400);
    f.time = time;
  }
  if (location !== undefined) f.location = String(location ?? '').slice(0, 200);

  // القرعة الموجّهة: الأدمن يغيّر طرفي المباراة — قبل تسجيل أي نتيجة فقط.
  if (aId !== undefined || bId !== undefined) {
    if (f.status !== 'pending') throw new AppError('لا يمكن تغيير طرفي مباراة ملعوبة أو صعود مباشر', 400);
    if (f.stage === 'knockout' && f.round > 1) throw new AppError('أطراف الأدوار المتقدمة تتحدد بالنتائج', 400);
    if (await countPlayed(t)) throw new AppError('لا يمكن تغيير الأطراف بعد تسجيل نتائج', 400);
    const na = String(aId ?? f.aId);
    const nb = String(bId ?? f.bId);
    if (na === nb) throw new AppError('لا يمكن أن يلعب المشارك ضد نفسه', 400);
    if (![na, nb].every(isId)) throw new AppError('المشارك غير موجود في هذه البطولة', 400);
    const ps = await Participant.find({ tournamentId: t._id, _id: { $in: [na, nb] } });
    if (ps.length !== 2) throw new AppError('المشارك غير موجود في هذه البطولة', 400);
    if (f.stage === 'group' && ps.some((p) => p.groupIndex !== f.groupIndex)) {
      throw new AppError('الطرفان يجب أن يكونا من نفس المجموعة', 400);
    }
    f.aId = na;
    f.bId = nb;
  }
  await f.save();
  return sendSuccess(res, { data: f.toJSON(), message: 'تم تحديث المباراة بنجاح' });
};

// ─── النتائج ──────────────────────────────────────────────────────────────────
const nextOf = (f) =>
  f.stage === 'knockout' && f.nextMatchNo
    ? Fixture.findOne({ tournamentId: f.tournamentId, stage: 'knockout', round: f.round + 1, matchNo: f.nextMatchNo })
    : null;

// تعديل نتيجة في المجموعات بعد إنشاء الأدوار الإقصائية: نعيد بناء الشجرة إن لم يُلعب منها شيء.
const guardGroupChange = async (t, f) => {
  if (f.stage !== 'group') return;
  const ko = await Fixture.find({ tournamentId: t._id, stage: 'knockout' });
  if (!ko.length) return;
  if (ko.some((k) => k.status === 'played')) {
    throw new AppError('بدأت الأدوار الإقصائية — لا يمكن تعديل نتائج المجموعات', 400);
  }
  await Fixture.deleteMany({ tournamentId: t._id, stage: 'knockout' });
};

// بعد أي تغيير: إنشاء الأدوار الإقصائية عند اكتمال المجموعات، وتحديث حالة البطولة.
const afterResultChange = async (t) => {
  const fixtures = await Fixture.find({ tournamentId: t._id });
  const done = (list) => list.length > 0 && list.every((f) => f.status !== 'pending');

  if (t.format === 'groups_knockout') {
    const groupFx = fixtures.filter((f) => f.stage === 'group');
    if (done(groupFx) && !fixtures.some((f) => f.stage === 'knockout')) {
      const parts = await Participant.find({ tournamentId: t._id });
      const standings = standingsFor(t, parts, fixtures).map((g) => g.rows);
      const docs = knockoutDocs(t, E.qualifiersFromGroups(standings, t.groups.qualifiersPerGroup));
      await Fixture.insertMany(docs);
      fixtures.push(...docs);
    }
  }

  let finished;
  if (t.format === 'league') {
    finished = done(fixtures);
  } else {
    const ko = fixtures.filter((f) => f.stage === 'knockout');
    const finalRound = Math.max(0, ...ko.map((f) => f.round));
    finished = done(ko.filter((f) => f.round === finalRound));
  }
  const status = finished ? 'finished' : 'running';
  if (t.status !== status) {
    t.status = status;
    await t.save();
  }
};

const recordResult = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  if (t.status === 'draft') throw new AppError('ولّد جدول المباريات أولاً', 400);
  const f = await findFixture(t, req.params.fixtureId);
  if (f.status === 'bye') throw new AppError('هذه مباراة صعود مباشر بدون نتيجة', 400);
  if (!f.aId || !f.bId) throw new AppError('طرفا المباراة لم يتحددا بعد', 400);

  const next = await nextOf(f);
  if (next && next.status === 'played') throw new AppError('امسح نتيجة المباراة التالية أولاً', 400);

  const r = E.evaluateResult(req.body, t, f.stage);
  await guardGroupChange(t, f);

  f.set({
    scoreA: r.scoreA,
    scoreB: r.scoreB,
    sets: r.sets,
    penaltiesA: r.penaltiesA,
    penaltiesB: r.penaltiesB,
    winnerId: r.outcome === 'a' ? f.aId : r.outcome === 'b' ? f.bId : null,
    status: 'played',
  });
  await f.save();
  if (next) {
    next[f.nextSlot === 'a' ? 'aId' : 'bId'] = f.winnerId;
    await next.save();
  }
  await afterResultChange(t);

  if (t.visibleToPlayers) {
    const parts = await Participant.find({ _id: { $in: [f.aId, f.bId] } });
    notifyParticipants(parts, {
      type: 'TOURNAMENT_RESULT',
      title: `نتيجة مباراة في ${t.name}`,
      body: parts.map((p) => p.name).join(' × '),
      meta: { tournamentId: t._id.toString(), fixtureId: f._id.toString() },
    }).catch(() => {});
  }
  const detail = await buildDetail(t);
  return sendSuccess(res, { data: detail, message: 'تم تسجيل النتيجة بنجاح' });
};

const clearResult = async (req, res) => {
  const t = await loadTournament(req, { manage: true });
  const f = await findFixture(t, req.params.fixtureId);
  if (f.status !== 'played') throw new AppError('لا توجد نتيجة لمسحها', 400);
  const next = await nextOf(f);
  if (next && next.status === 'played') throw new AppError('امسح نتيجة المباراة التالية أولاً', 400);
  await guardGroupChange(t, f);

  f.set({ scoreA: null, scoreB: null, sets: [], penaltiesA: null, penaltiesB: null, winnerId: null, status: 'pending' });
  await f.save();
  if (next) {
    next[f.nextSlot === 'a' ? 'aId' : 'bId'] = null;
    await next.save();
  }
  await afterResultChange(t);
  const detail = await buildDetail(t);
  return sendSuccess(res, { data: detail, message: 'تم مسح النتيجة' });
};

// ─── بوابة اللاعب (قراءة فقط) ─────────────────────────────────────────────────
const playerFilter = (req) => ({
  academyIds: req.player.academyId,
  visibleToPlayers: true,
  status: { $ne: 'draft' },
});

const listPlayerTournaments = async (req, res) => {
  const items = await Tournament.find(playerFilter(req)).sort({ createdAt: -1 }).limit(100);
  const mine = await Participant.find({
    tournamentId: { $in: items.map((t) => t._id) },
    playerIds: req.player._id,
  }).select('tournamentId');
  const mineSet = new Set(mine.map((p) => p.tournamentId.toString()));
  return sendSuccess(res, {
    data: items.map((t) => ({ ...t.toJSON(), isParticipant: mineSet.has(t._id.toString()) })),
    message: 'تم جلب البطولات بنجاح',
  });
};

const getPlayerTournament = async (req, res) => {
  if (!isId(req.params.id)) throw new AppError('البطولة غير موجودة', 404);
  const t = await Tournament.findOne({ _id: req.params.id, ...playerFilter(req) });
  if (!t) throw new AppError('البطولة غير موجودة', 404);
  const detail = await buildDetail(t, { forPlayer: req.player._id });
  return sendSuccess(res, { data: detail, message: 'تم جلب البطولة بنجاح' });
};

module.exports = {
  listTournaments,
  getTournament,
  createTournament,
  updateTournament,
  deleteTournament,
  addParticipant,
  updateParticipant,
  removeParticipant,
  orderParticipants,
  generateFixtures,
  resetFixtures,
  updateFixture,
  recordResult,
  clearResult,
  listPlayerTournaments,
  getPlayerTournament,
};
