/**
 * Safe, idempotent migration: make Groups independent from Sports.
 *
 * Background:
 *   Groups used to carry `sportId` and `ageGroup` fields and were validated
 *   against a player's sport. Groups are now purely organizational divisions
 *   inside an Academy (Branch A, Hall 1, Morning Session, ...) and have NO
 *   relation to any sport.
 *
 * What it does (structural cleanup only — NO player data is touched):
 *   Removes the legacy `sportId` and `ageGroup` fields from every Group
 *   document that still has them. Players keep their existing `groupId`
 *   links exactly as-is, so no player is orphaned and no data is lost.
 *
 * What it does NOT do:
 *   - It never deletes a Group.
 *   - It never changes any Player (groupId / sportId stay intact).
 *   - Running it multiple times is harmless (matched count becomes 0).
 *
 * Usage (from backend/ with .env present):
 *   node scripts/migrate_groups_independent.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI غير موجود في البيئة');
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: 'basketball_academy' });
  console.log('✅ متصل بقاعدة البيانات');

  const groups = mongoose.connection.db.collection('groups');

  const result = await groups.updateMany(
    { $or: [{ sportId: { $exists: true } }, { ageGroup: { $exists: true } }] },
    { $unset: { sportId: '', ageGroup: '' } }
  );

  // إسقاط الفهرس القديم المركّب على sportId إن وُجد (لم يعد له معنى).
  try {
    await groups.dropIndex('academyId_1_sportId_1');
    console.log('✅ تم إسقاط الفهرس القديم academyId_1_sportId_1');
  } catch (e) {
    // الفهرس غير موجود — لا مشكلة.
  }

  console.log(
    `✅ اكتملت الهجرة — تم تنظيف ${result.modifiedCount} مجموعة (المطابِقة: ${result.matchedCount})`
  );
  console.log('ℹ️ لم يُمَس أي لاعب — روابط اللاعبين بالمجموعات محفوظة كما هي.');

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('❌ فشلت الهجرة:', err);
  process.exit(1);
});
