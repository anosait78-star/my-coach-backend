require('dotenv').config();
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const https = require('https');
const fs = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function testMongoDB() {
  console.log('\n━━━ 1. MongoDB Atlas ━━━');
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, { dbName: 'academy' });
    console.log(`✅ متصل: ${conn.connection.host}`);
    console.log(`✅ قاعدة البيانات: ${conn.connection.name}`);

    // Test write: create a temp doc
    const TestModel = mongoose.model('_test', new mongoose.Schema({ v: String, ts: Date }));
    const doc = await TestModel.create({ v: 'connection_test', ts: new Date() });
    console.log(`✅ كتابة نجحت: _id=${doc._id}`);
    await TestModel.deleteOne({ _id: doc._id });
    console.log(`✅ حذف نجح (تنظيف)`);

    await mongoose.disconnect();
    return true;
  } catch (err) {
    console.error(`❌ MongoDB فشل: ${err.message}`);
    return false;
  }
}

async function testCloudinary() {
  console.log('\n━━━ 2. Cloudinary ━━━');
  try {
    const result = await cloudinary.api.ping();
    console.log(`✅ متصل: status=${result.status}`);
    console.log(`✅ Cloud: ${process.env.CLOUDINARY_CLOUD_NAME}`);

    // Upload a small test image (1x1 pixel PNG as base64)
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const uploadResult = await cloudinary.uploader.upload(tinyPng, {
      folder: 'basketball_academy/test',
      public_id: 'connection_test_' + Date.now(),
    });
    console.log(`✅ رفع صورة نجح: ${uploadResult.secure_url}`);
    console.log(`✅ public_id: ${uploadResult.public_id}`);

    // Delete the test image
    await cloudinary.uploader.destroy(uploadResult.public_id);
    console.log(`✅ حذف الصورة نجح`);

    return true;
  } catch (err) {
    console.error(`❌ Cloudinary فشل: ${err.message}`);
    return false;
  }
}

async function testPlayerCreation() {
  console.log('\n━━━ 3. إنشاء لاعب حقيقي في MongoDB ━━━');
  try {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'academy' });

    // Load Player model
    const Player = require('./src/models/player.model');

    // Get a dummy academyId (ObjectId format)
    const { Types } = mongoose;
    const dummyAcademyId = new Types.ObjectId();

    const testPlayer = await Player.create({
      academyId: dummyAcademyId,
      fullName: 'لاعب اختبار الاتصال',
      birthDate: new Date('2010-01-01'),
      parentName: 'ولي اختبار',
      parentRelationship: 'أب',
      parentPhone: '0501234567',
    });

    console.log(`✅ اللاعب أُنشئ: ${testPlayer.playerCode} - ${testPlayer.fullName}`);
    console.log(`✅ _id: ${testPlayer._id}`);
    console.log(`✅ playerCode (تلقائي): ${testPlayer.playerCode}`);

    await Player.deleteOne({ _id: testPlayer._id });
    console.log(`✅ حُذف (تنظيف)`);

    await mongoose.disconnect();
    return true;
  } catch (err) {
    console.error(`❌ إنشاء لاعب فشل: ${err.message}`);
    try { await mongoose.disconnect(); } catch (_) {}
    return false;
  }
}

(async () => {
  console.log('🔍 اختبار الاتصالات...\n');

  const mongo = await testMongoDB();
  const cloud = await testCloudinary();
  const player = await testPlayerCreation();

  console.log('\n━━━ النتيجة النهائية ━━━');
  console.log(`MongoDB Atlas:     ${mongo  ? '✅ يعمل' : '❌ فشل'}`);
  console.log(`Cloudinary:        ${cloud  ? '✅ يعمل' : '❌ فشل'}`);
  console.log(`إنشاء لاعب:        ${player ? '✅ يعمل' : '❌ فشل'}`);

  process.exit(mongo && cloud && player ? 0 : 1);
})();
