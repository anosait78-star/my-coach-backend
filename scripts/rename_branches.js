/* eslint-disable no-console */
// إعادة تسمية الفروع المخزَّنة على سجلات اللاعبين بعد تصحيح أسماء الفروع في
// التطبيق. الحقل `branch` نصّي للعرض فقط، فاللاعبون المسجَّلون قبل التصحيح
// ما زالوا يحملون الاسم القديم ("فرع مدينة بدر (1)" / "(2)").
//
// التشغيل:  node scripts/rename_branches.js          ← معاينة فقط (لا تعديل)
//           node scripts/rename_branches.js --apply  ← تنفيذ التعديل
require('dotenv').config();
const mongoose = require('mongoose');

const Player = require('../src/models/player.model');

// الاسم القديم ← الاسم الصحيح. بدر (1) = المخابرات، بدر (2) = النرجس.
const RENAMES = {
  'فرع مدينة بدر (1)': 'فرع المخابرات',
  'فرع مدينة بدر (2)': 'فرع النرجس',
};

const run = async () => {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI غير معرّف في البيئة');

  await mongoose.connect(uri);
  console.log(`متصل بقاعدة البيانات — الوضع: ${apply ? 'تنفيذ' : 'معاينة فقط'}\n`);

  let total = 0;
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    const count = await Player.countDocuments({ branch: oldName });
    total += count;
    console.log(`${oldName}  →  ${newName}   (${count} لاعب)`);
    if (apply && count > 0) {
      const res = await Player.updateMany(
        { branch: oldName },
        { $set: { branch: newName } }
      );
      console.log(`  تم تحديث ${res.modifiedCount} سجل`);
    }
  }

  console.log(`\nالإجمالي: ${total} لاعب`);
  if (!apply && total > 0) {
    console.log('أعد التشغيل مع --apply لتنفيذ التعديل.');
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error('فشل السكربت:', err.message);
  process.exit(1);
});
