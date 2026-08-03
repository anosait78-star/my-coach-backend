/**
 * استرجاع جراحي للّاعبين الذين حُذفوا (soft-delete) عن طريق الخطأ في دفعة
 * 2026-06-21 بواسطة المستخدم «استاذ احمد نصار».
 *
 * المنطق:
 *   1. يقرأ سجلات النشاط: actionType=DELETE_PLAYER لهذا المستخدم ضمن النافذة
 *      الزمنية للحادثة، ويجمع entityId (معرّفات اللاعبين المحذوفين).
 *   2. يسترجع فقط اللاعبين الذين ما زالوا isActive:false من تلك القائمة
 *      (لن يلمس أي لاعب حُذف عمداً في وقت آخر، ولن يغيّر أي لاعب نشط).
 *
 * الأمان:
 *   - افتراضياً DRY-RUN: يطبع ما سيفعله فقط دون أي كتابة.
 *   - للتنفيذ الفعلي مرّر العَلم:  --apply
 *
 * الاستخدام (من مجلد backend مع وجود .env):
 *   node scripts/restore_deleted_players.js            # معاينة فقط
 *   node scripts/restore_deleted_players.js --apply    # تنفيذ الاسترجاع
 */
require('dotenv').config();
const mongoose = require('mongoose');

// ── إعدادات الحادثة (مبنية على التشخيص) ──────────────────────────────────────
const CULPRIT_USERNAME = 'استاذ احمد نصار';
const WINDOW_START = new Date('2026-06-21T11:10:00.000Z');
const WINDOW_END = new Date('2026-06-21T11:23:00.000Z');

const APPLY = process.argv.includes('--apply');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('❌ MONGODB_URI غير موجود'); process.exit(1); }

  await mongoose.connect(uri, { dbName: 'basketball_academy' });
  console.log(`✅ متصل — الوضع: ${APPLY ? 'APPLY (سيكتب)' : 'DRY-RUN (معاينة فقط)'}`);

  const activities = mongoose.connection.db.collection('activities');
  const players = mongoose.connection.db.collection('players');

  // 1) جمع معرّفات اللاعبين المحذوفين في الحادثة
  const delActs = await activities.find({
    actionType: 'DELETE_PLAYER',
    userName: CULPRIT_USERNAME,
    createdAt: { $gte: WINDOW_START, $lte: WINDOW_END },
  }, { projection: { entityId: 1 } }).toArray();

  const ids = [...new Set(delActs.map(a => a.entityId).filter(Boolean))]
    .map(id => { try { return new mongoose.Types.ObjectId(String(id)); } catch (_) { return null; } })
    .filter(Boolean);

  console.log(`🗂️  سجلات DELETE_PLAYER في النافذة: ${delActs.length}`);
  console.log(`🆔 معرّفات فريدة صالحة: ${ids.length}`);

  // 2) من هؤلاء، مَن ما زال isActive:false (مرشّح فعلي للاسترجاع)
  const toRestore = await players.find(
    { _id: { $in: ids }, isActive: false },
    { projection: { playerCode: 1, fullName: 1 } }
  ).toArray();

  console.log(`♻️  مرشّحون للاسترجاع (isActive:false حالياً): ${toRestore.length}`);
  console.log('   عيّنة:', toRestore.slice(0, 10).map(p => `${p.playerCode}:${p.fullName}`).join(' | '));

  if (!APPLY) {
    console.log('\n— DRY-RUN — لم يتم تنفيذ أي تعديل. للتنفيذ: node scripts/restore_deleted_players.js --apply');
    await mongoose.disconnect();
    process.exit(0);
  }

  // 3) التنفيذ الفعلي — استرجاع جراحي
  const restoreIds = toRestore.map(p => p._id);
  const res = await players.updateMany(
    { _id: { $in: restoreIds }, isActive: false },
    { $set: { isActive: true } }
  );
  console.log(`✅ تم استرجاع ${res.modifiedCount} لاعباً (تعيين isActive:true).`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => { console.error('❌ خطأ:', err.message); process.exit(1); });
