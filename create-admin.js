require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'basketball_academy' });
  console.log('✅ MongoDB connected');
};

const createSuperAdmin = async () => {
  await connectDB();
  const User = require('./src/models/user.model');

  const email = 'ahmed@admin.com';
  const existing = await User.findOne({ email });

  if (existing) {
    // Update password and ensure active + super_admin
    existing.password = 'Aa20124194114@';
    existing.role = 'super_admin';
    existing.isActive = true;
    await existing.save();
    console.log(`✅ Updated existing user: ${email}`);
  } else {
    await User.create({
      name: 'Ahmed Admin',
      email: email,
      password: 'Aa20124194114@',
      role: 'super_admin',
      isActive: true,
    });
    console.log(`✅ Created super_admin: ${email}`);
  }

  console.log('\n=================================');
  console.log('Email:    ahmed@admin.com');
  console.log('Password: Aa20124194114@');
  console.log('Role:     super_admin');
  console.log('=================================');
  process.exit(0);
};

createSuperAdmin().catch((err) => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
