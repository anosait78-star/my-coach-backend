require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/database');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');

const authRoutes = require('./routes/auth.routes');
const academyRegistrationRoutes = require('./routes/academyRegistration.routes');
const academyRoutes = require('./routes/academy.routes');
const userRoutes = require('./routes/user.routes');
const playerRoutes = require('./routes/player.routes');
const groupRoutes = require('./routes/group.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const evaluationRoutes = require('./routes/evaluation.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const staffRoutes = require('./routes/staff.routes');
const staffAttendanceRoutes = require('./routes/staffAttendance.routes');
const payrollRoutes = require('./routes/payroll.routes');
const expenseRoutes = require('./routes/expense.routes');
// منصة Nosait SaaS
const platformSubscriptionRoutes = require('./routes/platformSubscription.routes');
const playerAuthRoutes = require('./routes/playerAuth.routes');
const playerPortalRoutes = require('./routes/playerPortal.routes');
const chatRoutes = require('./routes/chat.routes');
const notificationRoutes = require('./routes/notification.routes');
const academyAlbumRoutes = require('./routes/academyAlbum.routes');
const storeRoutes = require('./routes/store.routes');
const matchRoutes = require('./routes/match.routes');

const app = express();

// التطبيق يعمل خلف Nginx reverse proxy واحد. نثق بأول وكيل (hop) فقط حتى يقرأ
// Express و express-rate-limit عنوان العميل الحقيقي من رأس X-Forwarded-For،
// ويُحدّد المعدّل لكل IP حقيقي بدل IP الـ Proxy. القيمة 1 (وليست true) أكثر
// أماناً لأنها تثق بوكيل واحد معروف فقط وتمنع تحذير ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// نتأكد أن اتصال MongoDB جاهز قبل تنفيذ أي مسار — ضروري في بيئة serverless
// حيث لا يوجد ضمان إن استدعاء connectDB() عند إقلاع الوحدة قد اكتمل قبل
// وصول أول طلب لحاوية باردة (cold start).
app.use((req, res, next) => {
  connectDB().then(() => next()).catch(next);
});

app.use(helmet());

// عند ضبط FRONTEND_URL نُقيّد الأصل ونسمح بالـ credentials؛ وإلا (تطبيق موبايل
// بلا أصل محدّد) نسمح بأي أصل لكن دون credentials — لأن المتصفحات ترفض الجمع بين
// origin:'*' و credentials:true، وهذا يمنع تسريب الجلسات عبر أصول غير موثوقة.
const allowedOrigin = process.env.FRONTEND_URL;
app.use(cors({
  origin: allowedOrigin || '*',
  credentials: Boolean(allowedOrigin),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 500,
  message: { success: false, message: 'تم تجاوز الحد المسموح به من الطلبات' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Strict limiter for login only — 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'تم تجاوز الحد المسموح به من محاولات تسجيل الدخول' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));
}

app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'الخادم يعمل بشكل طبيعي',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

app.use('/api/v1/auth/login', loginLimiter);
app.use('/api/v1/auth', authRoutes);
// تسجيل ذاتي لأكاديمية جديدة (عام) — منصة Nosait SaaS.
app.use('/api/v1/register-academy', academyRegistrationRoutes);
app.use('/api/v1/academies', academyRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/players', playerRoutes);
app.use('/api/v1/groups', groupRoutes);
app.use('/api/v1/subscriptions', subscriptionRoutes);
app.use('/api/v1/evaluations', evaluationRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/staff', staffRoutes);
app.use('/api/v1/staff-attendance', staffAttendanceRoutes);
app.use('/api/v1/payroll', payrollRoutes);
app.use('/api/v1/expenses', expenseRoutes);
app.use('/api/v1/platform/subscriptions', platformSubscriptionRoutes);
app.use('/api/v1/auth/player', playerAuthRoutes);
app.use('/api/v1/player', playerPortalRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/academy-album', academyAlbumRoutes);
app.use('/api/v1/store', storeRoutes);
app.use('/api/v1/matches', matchRoutes);

app.use(notFound);
app.use(errorHandler);

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

// على Vercel يُستدعى الـ app مباشرة كدالة طلب لكل استدعاء serverless
// (راجع api/index.js)، فلا داعي لـ app.listen() ولا مفيد أصلاً في تلك البيئة.
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    logger.info(`🚀 الخادم يعمل على المنفذ ${PORT} في بيئة ${process.env.NODE_ENV}`);
  });

  process.on('unhandledRejection', (err) => {
    logger.error(`Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
  });
}

module.exports = app;
