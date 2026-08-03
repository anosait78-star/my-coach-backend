const mongoose = require('mongoose');
const logger = require('../utils/logger');

// في بيئة serverless (Vercel) قد تُعاد استدعاء هذه الدالة مع كل استدعاء
// للفانكشن على حاوية دافئة، فنُخزّن الـ Promise ونعيد استخدامه بدل فتح
// اتصال جديد أو الانتظار من الصفر في كل مرة. عند فشل الاتصال نطرح الخطأ
// ليتولاه errorHandler بدل إنهاء العملية بالكامل (process.exit) الذي يقتل
// الفانكشن في منتصف طلب المستخدم.
let connectionPromise = null;

const connectDB = () => {
  if (mongoose.connection.readyState === 1) {
    return Promise.resolve(mongoose.connection);
  }

  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(process.env.MONGODB_URI, {
        // يسمح بقاعدة بيانات معزولة للاختبار عبر MONGO_DB_NAME دون المساس
        // بقاعدة الإنتاج 'basketball_academy'. الإنتاج يبقى على القيمة الافتراضية.
        dbName: process.env.MONGO_DB_NAME || 'basketball_academy',
      })
      .then((conn) => {
        logger.info(`✅ MongoDB متصل: ${conn.connection.host}`);

        mongoose.connection.on('error', (err) => {
          logger.error(`MongoDB خطأ: ${err.message}`);
        });
        mongoose.connection.on('disconnected', () => {
          logger.warn('MongoDB انقطع الاتصال');
        });

        return conn;
      })
      .catch((error) => {
        connectionPromise = null; // اسمح بمحاولة إعادة الاتصال في الطلب التالي
        logger.error(`❌ فشل الاتصال بـ MongoDB: ${error.message}`);
        throw error;
      });
  }

  return connectionPromise;
};

module.exports = connectDB;
