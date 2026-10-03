/* eslint-disable no-console */
// توحيد المتجر: بعد أن صار المتجر واحداً لكل الفروع، المنتج الذي كان مُضافاً
// في أكثر من فرع يظهر مكرراً. هذا السكربت يجمع المنتجات بنفس الاسم ونفس السعر
// ويُبقي نسخة واحدة (الأقدم)، ويحذف الباقي مع صورها من Cloudinary.
//
// الطلبات القديمة لا تتأثر: تحمل لقطة اسم المنتج وسعره وقت الطلب.
//
// التشغيل:  node scripts/dedupe_store_products.js          ← معاينة فقط (لا حذف)
//           node scripts/dedupe_store_products.js --apply  ← تنفيذ الحذف
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const StoreProduct = require('../src/models/storeProduct.model');
const { deleteImage } = require('../src/config/cloudinary');

const keyOf = (p) => `${p.name.trim().replace(/\s+/g, ' ').toLowerCase()}|${Number(p.price)}`;

const run = async () => {
  const apply = process.argv.includes('--apply');
  await connectDB();
  console.log(`الوضع: ${apply ? 'تنفيذ' : 'معاينة فقط'}\n`);

  const products = await StoreProduct.find({})
    .select('+image_public_id')
    .sort({ created_at: 1 });

  const groups = new Map();
  for (const p of products) {
    const k = keyOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }

  let removed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const [keep, ...dupes] = list;
    console.log(`• "${keep.name}" (${keep.price}) — يُبقى ${keep._id}، مكرر ${dupes.length}`);
    for (const d of dupes) {
      console.log(`    - ${d._id}`);
      if (apply) {
        if (d.image_public_id) await deleteImage(d.image_public_id).catch(() => {});
        await d.deleteOne();
      }
      removed += 1;
    }
  }

  console.log(`\nإجمالي المنتجات: ${products.length} — المكرر: ${removed}`);
  if (!apply && removed) console.log('للحذف أعد التشغيل مع --apply');
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error('فشل:', err.message);
  process.exit(1);
});
