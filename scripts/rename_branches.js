/* eslint-disable no-console */
// توحيد اسم الفرع المخزَّن على سجلات اللاعبين مع اسم الفرع الصحيح.
//
// الحقل `branch` نصّي للعرض فقط، بينما academyId هو ما يحدّد الفرع فعلياً.
// لذلك نصحّح انطلاقاً من academyId لا من النص القديم: أي لاعب داخل أكاديمية
// معيّنة يجب أن يحمل اسم فرعها مهما كان النص المخزَّن. هذا يغطّي:
//   • من سجّل قبل تصحيح الأسماء ("فرع مدينة بدر (1)/(2)")
//   • من سجّل أثناء الفترة التي كان فيها الاسم مقترناً بـ academyId خاطئ
//
// التشغيل:  node scripts/rename_branches.js          ← معاينة فقط (لا تعديل)
//           node scripts/rename_branches.js --apply  ← تنفيذ التعديل
require('dotenv').config();
const mongoose = require('mongoose');

const Player = require('../src/models/player.model');
const Academy = require('../src/models/academy.model');

// نفس القائمة الموجودة في AppConstants.branches بالفرونت — academyId هو
// المرجع، والاسم تابع له.
const BRANCHES = [
  { academyId: '6a73d579c94b86f12268179a', name: 'فرع مدينة الشروق' },
  { academyId: '6a73d53dc94b86f12268178e', name: 'فرع المخابرات' },
  { academyId: '6a73d524c94b86f122681788', name: 'فرع النرجس' },
  { academyId: '6a73d561c94b86f122681794', name: 'فرع زهرة العاصمة' },
];

const run = async () => {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI غير معرّف في البيئة');

  await mongoose.connect(uri);
  console.log(`متصل بقاعدة البيانات — الوضع: ${apply ? 'تنفيذ' : 'معاينة فقط'}\n`);

  let total = 0;
  for (const { academyId, name } of BRANCHES) {
    const academy = await Academy.findById(academyId).select('name');
    if (!academy) {
      console.log(`⚠️  ${name}: لا توجد أكاديمية بالمعرّف ${academyId} — تخطٍّ`);
      continue;
    }

    // تحقّق يدوي مفيد: اسم الأكاديمية في القاعدة مقابل اسم الفرع في التطبيق.
    console.log(`${name}`);
    console.log(`   اسم الأكاديمية في القاعدة: "${academy.name}"`);

    // اللاعبون الذين لديهم اسم فرع مخزَّن ويختلف عن الاسم الصحيح.
    const filter = {
      academyId,
      branch: { $nin: [null, '', name] },
    };
    const stale = await Player.find(filter).select('fullName branch').limit(10);
    const count = await Player.countDocuments(filter);
    total += count;

    console.log(`   لاعبون باسم فرع قديم/خاطئ: ${count}`);
    stale.forEach((p) => console.log(`     • ${p.fullName}: "${p.branch}" → "${name}"`));
    if (count > stale.length) console.log(`     … و${count - stale.length} غيرهم`);

    if (apply && count > 0) {
      const res = await Player.updateMany(filter, { $set: { branch: name } });
      console.log(`   ✅ تم تحديث ${res.modifiedCount} سجل`);
    }
    console.log('');
  }

  console.log(`الإجمالي: ${total} لاعب`);
  if (!apply && total > 0) {
    console.log('أعد التشغيل مع --apply لتنفيذ التعديل.');
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error('فشل السكربت:', err.message);
  process.exit(1);
});
