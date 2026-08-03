/**
 * Safe, idempotent migration for multi-sport + attendance days support.
 *
 * What it does (only fills missing data — never overwrites existing values):
 *   1. Academy.sports        → ['كرة سلة']  when missing / empty.
 *   2. Player.sport          → academy's single sport, only for players in
 *                              single-sport academies that don't have a sport yet.
 *   3. Player.attendanceDays → []  when the field is missing.
 *
 * Existing data is preserved. Running it multiple times is harmless.
 *
 * Usage (from backend/ with .env present):
 *   node scripts/migrate_multisport.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const DEFAULT_SPORT = 'كرة سلة';

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI غير موجود في البيئة');
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: 'basketball_academy' });
  console.log('✅ متصل بقاعدة البيانات');

  const db = mongoose.connection.db;
  const academies = db.collection('academies');
  const players = db.collection('players');

  // ── 1. Academies: backfill sports ──────────────────────────────────────────
  const academyRes = await academies.updateMany(
    { $or: [{ sports: { $exists: false } }, { sports: { $size: 0 } }, { sports: null }] },
    { $set: { sports: [DEFAULT_SPORT] } }
  );
  console.log(`📋 أكاديميات تم تعيين الرياضات لها: ${academyRes.modifiedCount}`);

  // ── 2. Players: backfill sport for single-sport academies ──────────────────
  const allAcademies = await academies.find({}, { projection: { _id: 1, sports: 1 } }).toArray();
  let playerSportUpdates = 0;
  for (const academy of allAcademies) {
    const sports = Array.isArray(academy.sports) && academy.sports.length > 0
      ? academy.sports
      : [DEFAULT_SPORT];
    if (sports.length === 1) {
      const res = await players.updateMany(
        { academyId: academy._id, $or: [{ sport: { $exists: false } }, { sport: null }, { sport: '' }] },
        { $set: { sport: sports[0] } }
      );
      playerSportUpdates += res.modifiedCount;
    }
  }
  console.log(`🏀 لاعبون تم تعيين الرياضة لهم (أكاديميات أحادية الرياضة): ${playerSportUpdates}`);

  // ── 3. Players: backfill attendanceDays ────────────────────────────────────
  const attendanceRes = await players.updateMany(
    { attendanceDays: { $exists: false } },
    { $set: { attendanceDays: [] } }
  );
  console.log(`📅 لاعبون تم تهيئة أيام الحضور لهم: ${attendanceRes.modifiedCount}`);

  console.log('✅ اكتملت الهجرة بنجاح');
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('❌ فشلت الهجرة:', err);
  process.exit(1);
});
