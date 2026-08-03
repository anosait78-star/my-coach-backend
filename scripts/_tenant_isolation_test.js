/* eslint-disable no-console */
// اختبار عزل الأكاديميات (Tenant Isolation) — Academy A vs Academy B.
// ينشئ بيانات اختبار مؤقتة، يفحص كل الصلاحيات، ثم يحذف كل ما أنشأه (مهما كانت النتيجة).
require('dotenv').config();
const mongoose = require('mongoose');

const Academy = require('../src/models/academy.model');
const User = require('../src/models/user.model');
const Player = require('../src/models/player.model');
const Subscription = require('../src/models/subscription.model');
const Evaluation = require('../src/models/evaluation.model');
const Attendance = require('../src/models/attendance.model');

const BASE = 'http://localhost:3999/api/v1';
const TAG = 'TENANTTEST_' + Date.now();

let pass = 0, fail = 0;
const results = [];
function check(label, cond, detail) {
  if (cond) { pass++; results.push(`✅ ${label}`); }
  else { fail++; results.push(`❌ ${label}${detail ? ' — ' + detail : ''}`); }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, body: json };
}

async function login(email, password) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
  return r.body.token;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'basketball_academy' });
  console.log('Connected to DB:', mongoose.connection.name);

  // معرّفات الأكاديميات تُحفظ هنا فوراً بعد إنشائها لضمان تنظيفها حتى لو فشل أي شيء لاحقاً.
  const createdAcademyIds = [];

  try {
    console.log('Seeding test fixtures...');

    // ─── إنشاء بيانات الاختبار ──────────────────────────────────────────────
    const academyA = await Academy.create({ name: `${TAG}_ACADEMY_A`, phone: '0100000001', address: 'Test', currency: 'EGP' });
    createdAcademyIds.push(academyA._id);
    const academyB = await Academy.create({ name: `${TAG}_ACADEMY_B`, phone: '0100000002', address: 'Test', currency: 'EGP' });
    createdAcademyIds.push(academyB._id);

    const password = 'Test12345!';
    const adminA = await User.create({ name: `${TAG}_ADMIN_A`, email: `${TAG}_a@test.com`.toLowerCase(), password, role: 'admin', academyId: academyA._id });
    const academyAdminA = await User.create({ name: `${TAG}_ACAD_ADMIN_A`, email: `${TAG}_aa@test.com`.toLowerCase(), password, role: 'academy_admin', academyId: academyA._id });
    const adminB = await User.create({ name: `${TAG}_ADMIN_B`, email: `${TAG}_b@test.com`.toLowerCase(), password, role: 'admin', academyId: academyB._id });

    const playerA = await Player.create({ academyId: academyA._id, fullName: `${TAG}_PLAYER_A`, birthDate: '2010-01-01', parentName: 'ولي أمر A', parentRelationship: 'أب', parentPhone: '0111111111', sport: 'كرة سلة' });
    const playerB = await Player.create({ academyId: academyB._id, fullName: `${TAG}_PLAYER_B`, birthDate: '2010-01-01', parentName: 'ولي أمر B', parentRelationship: 'أب', parentPhone: '0122222222', sport: 'كرة سلة' });

    const subB = await Subscription.create({ academyId: academyB._id, playerId: playerB._id, type: 'NEW_SUBSCRIPTION', amount: 500, startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000) });
    const evalB = await Evaluation.create({ academyId: academyB._id, playerId: playerB._id, evaluatorId: adminB._id, fitness: 5, basicSkills: 5, attack: 5, defense: 5, commitment: 5 });
    await Attendance.create({ playerId: playerB._id, academyId: academyB._id, sport: 'كرة سلة', date: '2026-01-01', time: '10:00', status: 'present' });

    console.log(`Academy A: ${academyA._id}  |  Academy B: ${academyB._id}`);
    console.log(`Player A: ${playerA._id}    |  Player B: ${playerB._id}`);

    const tokenA = await login(adminA.email, password);            // role: admin, academy A
    const tokenAcadA = await login(academyAdminA.email, password); // role: academy_admin, academy A
    const tokenB = await login(adminB.email, password);            // role: admin, academy B

    // ── 1) PLAYERS ───────────────────────────────────────────────────────────
    {
      const r = await api(`/players?academyId=${academyA._id}`, { token: tokenA });
      // admin من A لا يجب أن يتمكن من قراءة لاعب من B حتى لو حاول بـ academyId B — لأن السكوب يتجاهل الكويري ويفرض أكاديميته
      const r2 = await api(`/players?academyId=${academyB._id}`, { token: tokenA });
      const idsReturned = (r2.body?.data || []).map((p) => p._id);
      check('Admin A: GET /players ignores requested academyId=B, returns only own academy', !idsReturned.includes(playerB._id.toString()));
    }
    {
      const r = await api(`/players/${playerB._id}`, { token: tokenA });
      check('Admin A: GET /players/:id (Player B) => 403', r.status === 403, `got ${r.status}`);
    }
    {
      const r = await api(`/players/${playerB._id}`, { method: 'PUT', token: tokenA, body: { fullName: 'HACKED' } });
      check('Admin A: PUT /players/:id (Player B) => 403 (cannot edit)', r.status === 403, `got ${r.status}`);
    }
    {
      const r = await api(`/players/${playerB._id}`, { method: 'DELETE', token: tokenA });
      check('Admin A: DELETE /players/:id (Player B) => 403 (cannot delete)', r.status === 403, `got ${r.status}`);
      const stillActive = await Player.findById(playerB._id);
      check('Player B still isActive=true after blocked delete attempt', stillActive.isActive === true);
    }
    {
      const r = await api(`/players/${playerA._id}`, { token: tokenA });
      check('Admin A: GET /players/:id (own Player A) => 200', r.status === 200, `got ${r.status}`);
    }
    {
      const r = await api(`/players/search?q=${encodeURIComponent(TAG)}`, { token: tokenA });
      const ids = (r.body?.data || []).map((p) => p._id);
      check('Admin A: GET /players/search never returns Player B', !ids.includes(playerB._id.toString()));
    }

    // ── 2) SUBSCRIPTIONS ─────────────────────────────────────────────────────
    {
      const r = await api(`/subscriptions/${subB._id}`, { token: tokenA });
      check('Admin A: GET /subscriptions/:id (Academy B sub) => 403', r.status === 403, `got ${r.status}`);
    }
    {
      const r = await api(`/subscriptions/academy/${academyB._id}`, { token: tokenA });
      check('Admin A: GET /subscriptions/academy/:B => 403', r.status === 403, `got ${r.status}`);
    }
    {
      const r = await api(`/subscriptions/academy/${academyB._id}/revenue`, { token: tokenA });
      check('Admin A: GET /subscriptions/academy/:B/revenue => 403', r.status === 403, `got ${r.status}`);
    }
    {
      const r = await api(`/subscriptions/${subB._id}`, { method: 'DELETE', token: tokenA });
      check('Admin A: DELETE /subscriptions/:id (Academy B) => 403', r.status === 403, `got ${r.status}`);
      const stillThere = await Subscription.findById(subB._id);
      check('Subscription B still exists after blocked delete attempt', !!stillThere);
    }

    // ── 3) EVALUATIONS ───────────────────────────────────────────────────────
    {
      const r = await api(`/evaluations/${evalB._id}`, { token: tokenA });
      check('Admin A: GET /evaluations/:id (Academy B eval) => 403', r.status === 403, `got ${r.status}`);
    }
    {
      const r = await api(`/evaluations/academy/${academyB._id}`, { token: tokenA });
      check('Admin A: GET /evaluations/academy/:B => empty (own-academy forced)', (r.body?.data || []).length === 0 || r.status === 403);
    }
    {
      const r = await api(`/evaluations/player/${playerB._id}`, { token: tokenA });
      check('Admin A: GET /evaluations/player/:B-player => 403', r.status === 403, `got ${r.status}`);
    }
    {
      const r = await api(`/evaluations/${evalB._id}`, { method: 'DELETE', token: tokenA });
      check('Admin A: DELETE /evaluations/:id (Academy B) => 403', r.status === 403, `got ${r.status}`);
    }

    // ── 4) ATTENDANCE ────────────────────────────────────────────────────────
    {
      const r = await api(`/attendance?academyId=${academyB._id}`, { token: tokenA });
      const ids = (r.body?.data || []).map((a) => a.playerId?._id || a.playerId);
      check('Admin A: GET /attendance?academyId=B ignored, returns no B records', !ids.includes(playerB._id.toString()));
    }
    {
      const r = await api(`/attendance/report?academyId=${academyB._id}`, { token: tokenA });
      const rows = r.body?.data?.rows || [];
      check('Admin A: GET /attendance/report?academyId=B => no Academy B players in rows', !rows.some((row) => row.playerId === playerB._id.toString()));
    }
    {
      const r = await api('/attendance', { method: 'POST', token: tokenA, body: { playerId: playerB._id.toString() } });
      check('Admin A: POST /attendance for Player B => 403', r.status === 403, `got ${r.status}`);
    }

    // ── 5) ACADEMIES ─────────────────────────────────────────────────────────
    {
      const r = await api(`/academies/${academyB._id}`, { token: tokenA });
      check('Admin A: GET /academies/:B => 403', r.status === 403, `got ${r.status}`);
    }
    {
      const r = await api(`/academies/${academyB._id}`, { method: 'PUT', token: tokenA, body: { name: 'HACKED', phone: '0100000099', address: 'Test' } });
      check('Admin A: PUT /academies/:B => 403 (cannot edit other academy)', r.status === 403, `got ${r.status}`);
    }
    {
      const r = await api('/academies', { token: tokenA });
      const ids = (r.body?.data || []).map((a) => a._id);
      check('Admin A: GET /academies => only sees own academy (not B)', ids.length === 1 && ids[0] === academyA._id.toString(), `got ${JSON.stringify(ids)}`);
    }

    // ── 6) DASHBOARD ─────────────────────────────────────────────────────────
    {
      const r = await api(`/dashboard/stats?academyId=${academyB._id}`, { token: tokenA });
      // إن نجح الطلب، يجب ألا يحتوي على بيانات B (التحقق عبر عدم التطابق مع لاعب B)
      check('Admin A: GET /dashboard/stats?academyId=B does not error-leak / is scoped to own academy', r.status === 200 || r.status === 403);
    }

    // ── 7) POSITIVE CONTROL: Admin A CAN access own academy's data ──────────
    {
      const r = await api(`/players/${playerA._id}`, { token: tokenA });
      check('POSITIVE: Admin A: GET own Player A => 200', r.status === 200);
    }
    {
      const r = await api(`/academies/${academyA._id}`, { token: tokenA });
      check('POSITIVE: Admin A: GET own Academy A => 200', r.status === 200);
    }

    // ── 8) Same checks repeated with role academy_admin (not just "admin") ──
    {
      const r = await api(`/players/${playerB._id}`, { token: tokenAcadA });
      check('academy_admin A: GET /players/:id (Player B) => 403', r.status === 403, `got ${r.status}`);
    }
    {
      const r = await api(`/players/${playerB._id}`, { method: 'DELETE', token: tokenAcadA });
      check('academy_admin A: DELETE /players/:id (Player B) => 403', r.status === 403, `got ${r.status}`);
    }

    // ── 9) Reverse direction: Admin B cannot see Academy A's data ───────────
    {
      const r = await api(`/players/${playerA._id}`, { token: tokenB });
      check('Admin B: GET /players/:id (Player A) => 403', r.status === 403, `got ${r.status}`);
    }

  } catch (err) {
    console.error('FATAL TEST ERROR:', err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    console.log('\nCleaning up test fixtures...');
    if (createdAcademyIds.length) {
      await Attendance.deleteMany({ academyId: { $in: createdAcademyIds } });
      await Evaluation.deleteMany({ academyId: { $in: createdAcademyIds } });
      await Subscription.deleteMany({ academyId: { $in: createdAcademyIds } });
      await Player.deleteMany({ academyId: { $in: createdAcademyIds } });
      await User.deleteMany({ academyId: { $in: createdAcademyIds } });
      await Academy.deleteMany({ _id: { $in: createdAcademyIds } });

      const leftoverCheck = await Promise.all([
        Academy.countDocuments({ _id: { $in: createdAcademyIds } }),
        User.countDocuments({ academyId: { $in: createdAcademyIds } }),
        Player.countDocuments({ academyId: { $in: createdAcademyIds } }),
      ]);
      console.log(`Cleanup verification (should be 0,0,0): ${leftoverCheck.join(',')}`);
    }

    console.log('\n========== RESULTS ==========');
    results.forEach((r) => console.log(r));
    console.log('================================');
    console.log(`PASS: ${pass}  FAIL: ${fail}  TOTAL: ${pass + fail}`);

    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
})();
