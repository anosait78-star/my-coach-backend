/**
 * Player Portal feature smoke test.
 * Runs against an ISOLATED test database (dbName: nosait_portal_test) —
 * production data is never touched. The test DB is dropped at the end.
 *
 * Usage: node scripts/_player_portal_test.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Academy = require('../src/models/academy.model');
const Player = require('../src/models/player.model');
const AcademySubscription = require('../src/models/academySubscription.model');
const PlayerAccount = require('../src/models/playerAccount.model');
const { checkPlayerPortal } = require('../src/utils/playerPortal');
const {
  createPlayerAccount,
  changePlayerPassword,
  resetPlayerPassword,
  togglePlayerAccount,
  getPlayerAccount,
  getAccountStats,
} = require('../src/controllers/playerAccountAdmin.controller');
const { playerLogin } = require('../src/controllers/playerAuth.controller');

let passed = 0;
let failed = 0;
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
};

// أدوات mock بسيطة لاستدعاء الـ controllers مباشرة.
const mockRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const call = async (fn, req) => {
  const res = mockRes();
  let nextErr = null;
  await fn(req, res, (e) => { nextErr = e || null; });
  return { res, nextErr };
};

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('❌ MONGODB_URI مفقود'); process.exit(1); }

  await mongoose.connect(uri, { dbName: 'nosait_portal_test' });
  console.log('✅ متصل بقاعدة الاختبار المعزولة (nosait_portal_test)');
  await mongoose.connection.dropDatabase();

  // ── تجهيز البيانات ─────────────────────────────────────────────────────────
  const academyNew = await Academy.create({ name: 'أكاديمية جديدة', phone: '01000000001', address: 'القاهرة', sports: ['كرة قدم'] });
  const academyOld = await Academy.create({ name: 'أكاديمية قديمة', phone: '01000000002', address: 'الجيزة', sports: ['كرة سلة'] });
  const academyExpired = await Academy.create({ name: 'أكاديمية منتهية', phone: '01000000003', address: 'طنطا', sports: ['كرة سلة'] });

  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86400000);
  const past = new Date(now.getTime() - 86400000);

  // أكاديمية جديدة: trial + portal enabled (كما في التسجيل الذاتي)
  await AcademySubscription.create({ academyId: academyNew._id, status: 'trial', plan: 'trial', maxPlayers: 7, startDate: now, endDate: in7d, playerPortalEnabled: true });
  // أكاديمية قديمة: active لكن الميزة معطّلة (ما بعد الهجرة)
  await AcademySubscription.create({ academyId: academyOld._id, status: 'active', plan: 'legacy', maxPlayers: 1000, startDate: now, endDate: in7d, playerPortalEnabled: false });
  // أكاديمية منتهية: الميزة مفعّلة لكن الاشتراك منتهٍ
  await AcademySubscription.create({ academyId: academyExpired._id, status: 'trial', plan: 'trial', maxPlayers: 7, startDate: past, endDate: past, playerPortalEnabled: true });

  const mkPlayer = (academyId, name) => Player.create({
    academyId, fullName: name, birthDate: new Date('2010-01-01'),
    parentName: 'ولي أمر', parentRelationship: 'أب', parentPhone: '0111111',
  });
  const p1 = await mkPlayer(academyNew._id, 'لاعب جديد');
  const p2 = await mkPlayer(academyOld._id, 'لاعب قديم');
  const p3 = await mkPlayer(academyNew._id, 'لاعب بلا حساب');

  const adminUser = (academyId) => ({ _id: new mongoose.Types.ObjectId(), role: 'academy_admin', academyId, name: 'مدير' });

  console.log('\n— 1) منطق تفعيل البوابة (checkPlayerPortal) —');
  ok('trial + enabled → active', (await checkPlayerPortal(academyNew._id)).active === true);
  const oldChk = await checkPlayerPortal(academyOld._id);
  ok('أكاديمية قديمة (flag=false) → PLAYER_PORTAL_DISABLED', !oldChk.active && oldChk.code === 'PLAYER_PORTAL_DISABLED');
  const expChk = await checkPlayerPortal(academyExpired._id);
  ok('trial منتهٍ + enabled → SUBSCRIPTION_EXPIRED', !expChk.active && expChk.code === 'SUBSCRIPTION_EXPIRED');
  ok('بلا اشتراك إطلاقاً → معطّلة', !(await checkPlayerPortal(new mongoose.Types.ObjectId())).active);

  console.log('\n— 2) إنشاء حساب للاعب قديم —');
  const { res: cRes } = await call(createPlayerAccount, { params: { id: p1._id.toString() }, user: adminUser(academyNew._id), body: {} });
  ok('إنشاء الحساب نجح (201)', cRes.statusCode === 201 && cRes.body?.success === true);
  const username = cRes.body?.data?.username || '';
  const plainPassword = cRes.body?.data?.password || '';
  ok('اسم المستخدم بصيغة nosaitXXXXX', /^nosait\d{5}$/.test(username));
  ok('كلمة المرور أُرجعت مرة واحدة', plainPassword.length >= 10);

  const savedAcc = await PlayerAccount.findOne({ playerId: p1._id }).select('+password');
  ok('كلمة المرور ليست نصاً صريحاً (bcrypt)', savedAcc.password !== plainPassword && savedAcc.password.startsWith('$2'));
  ok('bcrypt.compare يطابق', await bcrypt.compare(plainPassword, savedAcc.password));

  const { res: dupRes, nextErr: dupErr } = await call(createPlayerAccount, { params: { id: p1._id.toString() }, user: adminUser(academyNew._id), body: {} });
  ok('منع إنشاء حساب مكرر (409)', dupErr?.statusCode === 409 || dupRes.statusCode === 409);

  const { res: blockedRes } = await call(createPlayerAccount, { params: { id: p2._id.toString() }, user: adminUser(academyOld._id), body: {} });
  ok('إنشاء حساب مع بوابة معطّلة → 403 PLAYER_PORTAL_DISABLED', blockedRes.statusCode === 403 && blockedRes.body?.code === 'PLAYER_PORTAL_DISABLED');

  const { nextErr: crossErr } = await call(createPlayerAccount, { params: { id: p1._id.toString() }, user: adminUser(academyOld._id), body: {} });
  ok('عزل الأكاديميات: مدير أكاديمية أخرى → 403', crossErr?.statusCode === 403);

  console.log('\n— 3) تسجيل دخول اللاعب —');
  const { res: loginRes } = await call(playerLogin, { body: { username, password: plainPassword } });
  ok('دخول ناجح (trial + enabled)', loginRes.statusCode === 200 && !!loginRes.body?.token);

  console.log('\n— 4) تغيير كلمة المرور —');
  const { res: chRes } = await call(changePlayerPassword, { params: { id: p1._id.toString() }, user: adminUser(academyNew._id), body: { password: 'NewPass123' } });
  ok('تغيير كلمة المرور نجح', chRes.statusCode === 200);
  const acc2 = await PlayerAccount.findOne({ playerId: p1._id }).select('+password');
  ok('الكلمة الجديدة مشفّرة وتُطابق', acc2.password.startsWith('$2') && (await bcrypt.compare('NewPass123', acc2.password)));

  console.log('\n— 5) إعادة إنشاء كلمة المرور —');
  const { res: rstRes } = await call(resetPlayerPassword, { params: { id: p1._id.toString() }, user: adminUser(academyNew._id), body: {} });
  const newPlain = rstRes.body?.data?.password || '';
  ok('توليد كلمة عشوائية وإرجاعها', rstRes.statusCode === 200 && newPlain.length >= 10);
  const acc3 = await PlayerAccount.findOne({ playerId: p1._id }).select('+password');
  ok('العشوائية الجديدة تعمل مع bcrypt', await bcrypt.compare(newPlain, acc3.password));

  console.log('\n— 6) تعطيل/تفعيل الحساب —');
  const { res: disRes } = await call(togglePlayerAccount, { params: { id: p1._id.toString() }, user: adminUser(academyNew._id), body: { isActive: false } });
  ok('التعطيل نجح', disRes.statusCode === 200 && disRes.body?.data?.isActive === false);

  const { res: disLogin } = await call(playerLogin, { body: { username, password: newPlain } });
  ok('دخول حساب معطّل → 403 ACCOUNT_DISABLED', disLogin.statusCode === 403 && disLogin.body?.code === 'ACCOUNT_DISABLED');

  const { res: enRes } = await call(togglePlayerAccount, { params: { id: p1._id.toString() }, user: adminUser(academyNew._id), body: { isActive: true } });
  ok('إعادة التفعيل نجحت', enRes.statusCode === 200 && enRes.body?.data?.isActive === true);
  const { res: reLogin } = await call(playerLogin, { body: { username, password: newPlain } });
  ok('الدخول يعمل بعد إعادة التفعيل', reLogin.statusCode === 200);

  console.log('\n— 7) توقّف البوابة بانتهاء الاشتراك (جلسة قائمة/دخول) —');
  await AcademySubscription.updateOne({ academyId: academyNew._id }, { $set: { endDate: past } });
  const { res: expLogin } = await call(playerLogin, { body: { username, password: newPlain } });
  ok('انتهاء الاشتراك يمنع الدخول → SUBSCRIPTION_EXPIRED', expLogin.statusCode === 403 && expLogin.body?.code === 'SUBSCRIPTION_EXPIRED');
  await AcademySubscription.updateOne({ academyId: academyNew._id }, { $set: { endDate: in7d } });

  console.log('\n— 8) حالة الحساب والفلاتر والإحصائيات —');
  const { res: gaRes } = await call(getPlayerAccount, { params: { id: p3._id.toString() }, user: adminUser(academyNew._id) });
  ok('GET account: لاعب بلا حساب → hasAccount=false + portalEnabled=true', gaRes.body?.data?.hasAccount === false && gaRes.body?.data?.portalEnabled === true);

  const { res: statsRes } = await call(getAccountStats, { user: adminUser(academyNew._id), query: {} });
  ok('account-stats: withAccount=1 / withoutAccount=1', statsRes.body?.data?.withAccount === 1 && statsRes.body?.data?.withoutAccount === 1);

  // فلتر hasAccount في getPlayers (استعلام مباشر بنفس المنطق)
  const accIds = await PlayerAccount.find({ academyId: academyNew._id }).distinct('playerId');
  const withA = await Player.countDocuments({ academyId: academyNew._id, isActive: true, _id: { $in: accIds } });
  const withoutA = await Player.countDocuments({ academyId: academyNew._id, isActive: true, _id: { $nin: accIds } });
  ok('فلتر اللاعبين: لديهم حساب=1 / بدون=1', withA === 1 && withoutA === 1);

  console.log('\n— 9) موديل الاشتراك —');
  const subNew = await AcademySubscription.findOne({ academyId: academyNew._id });
  ok('isPlayerPortalActive=true (trial+enabled)', subNew.isPlayerPortalActive() === true);
  subNew.playerPortalEnabled = false;
  ok('isPlayerPortalActive=false بعد التعطيل', subNew.isPlayerPortalActive() === false);

  // ── تنظيف ──────────────────────────────────────────────────────────────────
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();

  console.log(`\n══════ النتيجة: ${passed} نجح / ${failed} فشل ══════`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error('❌ فشل الاختبار:', err);
  try { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
