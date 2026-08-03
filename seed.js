require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'basketball_academy' });
  console.log('✅ MongoDB connected');
};

const seed = async () => {
  await connectDB();

  const User = require('./src/models/user.model');
  const Academy = require('./src/models/academy.model');

  await User.deleteMany({});
  await Academy.deleteMany({});
  console.log('🗑️  Cleared existing data');

  const superAdmin = await User.create({
    name: 'مدير النظام',
    email: 'admin@basketball.com',
    password: 'Admin@123456',
    role: 'super_admin',
  });
  console.log(`✅ Super Admin: ${superAdmin.email}`);

  const academy = await Academy.create({
    name: 'أكاديمية النجوم لكرة السلة',
    phone: '+966501234567',
    address: 'الرياض، حي العليا، شارع التخصصي',
  });
  console.log(`✅ Academy: ${academy.name}`);

  await User.create({
    name: 'مدير الأكاديمية',
    email: 'academy@basketball.com',
    password: 'Academy@123456',
    role: 'academy_admin',
    academyId: academy._id,
  });
  console.log('✅ Academy Admin: academy@basketball.com');

  console.log('\n🎉 Seeding completed!');
  console.log('Super Admin:    admin@basketball.com   / Admin@123456');
  console.log('Academy Admin:  academy@basketball.com / Academy@123456');

  process.exit(0);
};

seed().catch((err) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
