const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const playerImageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'basketball_academy/players',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 400, height: 400, crop: 'fill', gravity: 'face' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  },
});

const academyLogoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'basketball_academy/logos',
    // SVG مُستبعَد عمداً: يمكن أن يحمل JavaScript ويؤدي إلى XSS مخزَّن عند
    // عرضه في واجهة الويب. نقتصر على صور نقطية آمنة فقط.
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 300, height: 300, crop: 'fit' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  },
});

// صور ألبوم الأكاديمية — نفس خدمة Cloudinary، مجلد مستقل. لا خدمة رفع جديدة.
const academyAlbumStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'basketball_academy/albums',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 1600, height: 1600, crop: 'limit' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  },
});

// صور منتجات المتجر — نفس خدمة Cloudinary، مجلد مستقل. لا خدمة رفع جديدة.
const storeProductStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'basketball_academy/store',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 1200, height: 1200, crop: 'limit' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  },
});

// صورة طقم الفريق — نفس خدمة Cloudinary، مجلد مستقل. لا خدمة رفع جديدة.
const teamKitStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'basketball_academy/team_kits',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 1200, height: 1200, crop: 'limit' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  },
});

const staffPhotoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'basketball_academy/staff',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 400, height: 400, crop: 'fill', gravity: 'face' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  },
});

// تخزين ملفات طلب الانضمام (تسجيل ذاتي للاعب) — حقلان مختلفان بنفس الـ multer
// instance: 'image' (صورة اللاعب، اختيارية) و'receipt' (صورة إيصال الدفع،
// مطلوبة). الـ params دالة تختار المجلد/التحويل حسب اسم الحقل.
const joinRequestStorage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    if (file.fieldname === 'receipt') {
      return {
        folder: 'basketball_academy/receipts',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [
          { width: 1600, height: 1600, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
      };
    }
    // fieldname === 'image' — نفس إعدادات صورة اللاعب العادية.
    return {
      folder: 'basketball_academy/players',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [
        { width: 400, height: 400, crop: 'fill', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    };
  },
});

// قائمة بيضاء صارمة لأنواع الصور النقطية المسموح بها. نرفض صراحةً
// image/svg+xml و text/html والملفات التنفيذية حتى لو زُوِّر امتداد الملف —
// وCloudinary يعيد ترميز الصورة بعد الرفع كطبقة دفاع ثانية.
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];

// حد أقصى موحّد لحجم أي صورة تُرفع في المنصة.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const fileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_MIME.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('يُسمح فقط برفع صور بصيغة JPG أو PNG أو WEBP'), false);
  }
};

const uploadPlayerImage = multer({
  storage: playerImageStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter,
});

const uploadAcademyLogo = multer({
  storage: academyLogoStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter,
});

const uploadStaffPhoto = multer({
  storage: staffPhotoStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter,
});

const uploadAlbumImage = multer({
  storage: academyAlbumStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter,
});

const uploadStoreImage = multer({
  storage: storeProductStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter,
});

const uploadKitImage = multer({
  storage: teamKitStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter,
});

const uploadJoinRequestFiles = multer({
  storage: joinRequestStorage,
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter,
}).fields([
  { name: 'receipt', maxCount: 1 },
  { name: 'image', maxCount: 1 },
]);

const deleteImage = async (publicId) => {
  return cloudinary.uploader.destroy(publicId);
};

module.exports = {
  cloudinary,
  uploadPlayerImage,
  uploadAcademyLogo,
  uploadStaffPhoto,
  uploadAlbumImage,
  uploadStoreImage,
  uploadKitImage,
  uploadJoinRequestFiles,
  deleteImage,
  MAX_IMAGE_BYTES,
};
