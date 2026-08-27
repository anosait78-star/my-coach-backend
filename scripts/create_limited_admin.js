/**
 * إنشاء/تحديث حساب "مدير عام محدود":
 * صلاحيات super_admin كاملة على كل الأكاديميات، ما عدا لوحة الإحصائيات
 * والإيرادات والتقارير (canViewReports = false).
 *
 * التشغيل:  node scripts/create_limited_admin.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

// بعض بيئات ويندوز لا تُمرِّر خوادم DNS الافتراضية لـ Node، فيفشل بحث SRV
// الخاص بـ mongodb+srv. نضبط خوادم عامة عند الحاجة فقط.
if (process.env.SCRIPT_DNS !== 'system') {
  require('dns').setServers(['8.8.8.8', '1.1.1.1']);
}

const EMAIL = process.env.LIMITED_ADMIN_EMAIL || 'sohila@admin.com';
const PASSWORD = process.env.LIMITED_ADMIN_PASSWORD || '12345678';
const NAME = process.env.LIMITED_ADMIN_NAME || 'سهيلة';

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'basketball_academy' });
  console.log('✅ MongoDB connected');

  const User = require('../src/models/user.model');
  const existing = await User.findOne({ email: EMAIL });

  if (existing) {
    existing.name = NAME;
    existing.password = PASSWORD;
    existing.role = 'super_admin';
    existing.academyId = undefined;
    existing.isActive = true;
    existing.canViewReports = false;
    await existing.save();
    console.log(`✅ تم تحديث الحساب: ${EMAIL}`);
  } else {
    await User.create({
      name: NAME,
      email: EMAIL,
      password: PASSWORD,
      role: 'super_admin',
      isActive: true,
      canViewReports: false,
    });
    console.log(`✅ تم إنشاء الحساب: ${EMAIL}`);
  }

  console.log('\n=================================');
  console.log(`Email:    ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log('Role:     super_admin (بدون إحصائيات/تقارير)');
  console.log('=================================');
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ فشل:', err.message);
  process.exit(1);
});
