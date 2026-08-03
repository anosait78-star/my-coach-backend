/**
 * Safe, idempotent migration for the Player Portal feature flag.
 *
 * What it does (only fills missing data — never overwrites and never deletes):
 *   Sets playerPortalEnabled = false on every AcademySubscription document
 *   that does NOT have the field yet. Existing values (true/false) are left
 *   untouched, and no Player or PlayerAccount document is modified at all.
 *
 * After this migration, existing academies have the Player Portal disabled
 * until the Super Admin enables it. New academies registered through the
 * wizard get playerPortalEnabled = true automatically at trial creation.
 *
 * Running it multiple times is harmless (matched count becomes 0).
 *
 * Usage (from backend/ with .env present):
 *   node scripts/migrate_player_portal.js
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

  const subs = mongoose.connection.db.collection('academysubscriptions');

  const result = await subs.updateMany(
    { playerPortalEnabled: { $exists: false } },
    { $set: { playerPortalEnabled: false } }
  );

  console.log(
    `✅ اكتملت الهجرة — تم ضبط playerPortalEnabled=false على ${result.modifiedCount} اشتراك (المطابِقة: ${result.matchedCount})`
  );
  console.log('ℹ️ لم يُمَس أي لاعب أو حساب لاعب حالي.');

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('❌ فشلت الهجرة:', err);
  process.exit(1);
});
