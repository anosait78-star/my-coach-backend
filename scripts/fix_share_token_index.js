/**
 * إصلاح لمرة واحدة: فهرس shareToken القديم (unique + sparse) كان يفهرس قيم
 * null، فيرفض إنشاء أي لاعب ثانٍ بخطأ "القيمة موجودة مسبقاً".
 * يحذف الفهرس القديم ويزيل قيم null المحفوظة. الفهرس الجديد (partial) يُنشئه
 * mongoose تلقائياً عند تشغيل الخادم.
 *
 * التشغيل:  node scripts/fix_share_token_index.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

if (process.env.SCRIPT_DNS !== 'system') {
  require('dns').setServers(['8.8.8.8', '1.1.1.1']);
}

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'basketball_academy' });
  const players = mongoose.connection.db.collection('players');

  const indexes = await players.indexes();
  const old = indexes.find((i) => i.key?.shareToken === 1 && !i.partialFilterExpression);
  if (old) {
    await players.dropIndex(old.name);
    console.log(`✅ حُذف الفهرس القديم: ${old.name}`);
  } else {
    console.log('ℹ️ لا يوجد فهرس قديم');
  }

  const res = await players.updateMany({ shareToken: null }, { $unset: { shareToken: '' } });
  console.log(`✅ أُزيلت قيم null من ${res.modifiedCount} لاعب`);

  // إنشاء الفهرس الجديد فقط (لا syncIndexes — قد يحذف فهارس أخرى غير معرّفة).
  await players.createIndex(
    { shareToken: 1 },
    {
      name: 'shareToken_unique_string',
      unique: true,
      partialFilterExpression: { shareToken: { $type: 'string' } },
    }
  );
  const after = await players.indexes();
  console.log('الفهارس الحالية لـ shareToken:',
    after.filter((i) => i.key?.shareToken).map((i) => i.name));

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ فشل:', err.message);
  process.exit(1);
});
