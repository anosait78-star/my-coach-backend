/**
 * Safe, idempotent migration for the SaaS platform subscription layer.
 *
 * What it does (only fills missing data — never overwrites or deletes anything):
 *   For every Academy WITHOUT an AcademySubscription document, it creates one
 *   with status = 'active', plan = 'legacy', maxPlayers = 100000 and a far-future
 *   endDate (+100y). This guarantees ALL existing academies keep working with NO
 *   trial limits and NO write blocking. Only NEW academies created through the
 *   registration wizard receive a real 7-day / 7-player trial.
 *
 * Existing subscriptions are left untouched. Running it multiple times is harmless.
 *
 * Usage (from backend/ with .env present):
 *   node scripts/migrate_academy_subscriptions.js
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

  const db = mongoose.connection.db;
  const academies = db.collection('academies');
  const subs = db.collection('academysubscriptions');

  const allAcademies = await academies.find({}, { projection: { _id: 1, name: 1 } }).toArray();
  console.log(`📋 عدد الأكاديميات: ${allAcademies.length}`);

  const now = new Date();
  const farFuture = new Date(now.getTime());
  farFuture.setFullYear(farFuture.getFullYear() + 100);

  let created = 0;
  let skipped = 0;

  for (const academy of allAcademies) {
    const existing = await subs.findOne({ academyId: academy._id });
    if (existing) {
      skipped += 1;
      continue;
    }
    await subs.insertOne({
      academyId: academy._id,
      status: 'active',
      plan: 'legacy',
      maxPlayers: 100000,
      startDate: now,
      endDate: farFuture,
      history: [
        {
          action: 'MIGRATED',
          plan: 'legacy',
          maxPlayers: 100000,
          startDate: now,
          endDate: farFuture,
          changedBy: null,
          changedByName: 'system-migration',
          note: 'ترحيل أكاديمية قائمة إلى اشتراك نشط غير محدود',
          changedAt: now,
        },
      ],
      created_at: now,
      updated_at: now,
      __v: 0,
    });
    created += 1;
    console.log(`   ➕ اشتراك نشط للأكاديمية: ${academy.name || academy._id}`);
  }

  console.log(`✅ اكتملت الهجرة — تم إنشاء ${created} اشتراك، وتخطّي ${skipped} موجود مسبقاً`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('❌ فشلت الهجرة:', err);
  process.exit(1);
});
