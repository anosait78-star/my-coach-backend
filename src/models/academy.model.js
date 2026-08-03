const mongoose = require('mongoose');

const academySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم الأكاديمية مطلوب'],
      trim: true,
      minlength: [2, 'الاسم يجب أن يكون حرفين على الأقل'],
      maxlength: [150, 'الاسم لا يمكن أن يتجاوز 150 حرف'],
    },
    logo_url: {
      type: String,
      default: null,
    },
    logo_public_id: {
      type: String,
      default: null,
      select: false,
    },
    phone: {
      type: String,
      required: [true, 'رقم الهاتف مطلوب'],
      trim: true,
      match: [/^[0-9+\-\s()]{7,20}$/, 'رقم الهاتف غير صحيح'],
    },
    // رقم واتساب المتجر — تُرسَل إليه طلبات الشراء. اختياري وهجرة آمنة:
    // إذا لم يُضبط تقع رسالة الشراء تلقائياً على phone (fallback في الـ controller).
    storeWhatsApp: {
      type: String,
      trim: true,
      default: '',
      match: [/^[0-9+\-\s()]{0,20}$/, 'رقم واتساب المتجر غير صحيح'],
    },
    address: {
      type: String,
      required: [true, 'العنوان مطلوب'],
      trim: true,
      maxlength: [300, 'العنوان لا يمكن أن يتجاوز 300 حرف'],
    },
    // روابط التواصل الاجتماعي — اختيارية، تظهر للاعب في لوحة التحكم الخاصة به إن وُجدت.
    websiteUrl: {
      type: String,
      trim: true,
      default: '',
    },
    facebookUrl: {
      type: String,
      trim: true,
      default: '',
    },
    tiktokUrl: {
      type: String,
      trim: true,
      default: '',
    },
    instagramUrl: {
      type: String,
      trim: true,
      default: '',
    },
    currency: {
      type: String,
      // العملة تُشتق من دولة الأكاديمية (كل الدول العربية) — نسمح بكل عملاتها
      // + USD للمرونة/التوافق مع الأكاديميات القديمة.
      enum: {
        values: [
          'EGP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'LBP', 'SYP',
          'IQD', 'ILS', 'YER', 'LYD', 'TND', 'DZD', 'MAD', 'MRU', 'SDG', 'SOS',
          'DJF', 'KMF', 'USD',
        ],
        message: 'العملة غير صحيحة',
      },
      // الأكاديميات الحالية تبقى على الجنيه المصري (هجرة آمنة)
      default: 'EGP',
    },
    // الرياضات الموجودة بالأكاديمية (Multi-sport support).
    // قائمة نصية حرّة قابلة للتوسعة مستقبلاً بأي رياضة.
    // الأكاديميات الحالية تُهاجَر تلقائياً إلى رياضة واحدة فيستمر النظام كما هو.
    sports: {
      type: [String],
      default: ['كرة سلة'],
      validate: {
        validator: function (arr) {
          return (
            Array.isArray(arr) &&
            arr.length > 0 &&
            arr.every((s) => typeof s === 'string' && s.trim().length > 0)
          );
        },
        message: 'يجب اختيار رياضة واحدة على الأقل',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        delete ret.__v;
        delete ret.logo_public_id;
        return ret;
      },
    },
  }
);

academySchema.virtual('player_count', {
  ref: 'Player',
  localField: '_id',
  foreignField: 'academyId',
  count: true,
});

academySchema.index({ name: 'text' });
academySchema.index({ isActive: 1 });

const Academy = mongoose.model('Academy', academySchema);
module.exports = Academy;
