const mongoose = require('mongoose');

// منتج في متجر أكاديمية. كل منتج مرتبط حتمياً بـ academyId، فلا يرى لاعبو
// أكاديمية منتجات أكاديمية أخرى (يُفرَض في الـ controller — نفس نمط الألبوم).
const storeProductSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    name: {
      type: String,
      required: [true, 'اسم المنتج مطلوب'],
      trim: true,
      minlength: [1, 'اسم المنتج مطلوب'],
      maxlength: [150, 'اسم المنتج لا يمكن أن يتجاوز 150 حرف'],
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: [1000, 'الوصف لا يمكن أن يتجاوز 1000 حرف'],
    },
    price: {
      type: Number,
      required: [true, 'سعر المنتج مطلوب'],
      min: [0, 'السعر لا يمكن أن يكون سالباً'],
    },
    image_url: {
      type: String,
      required: [true, 'صورة المنتج مطلوبة'],
    },
    // مخفي عن العميل؛ يُستخدم لحذف الصورة من Cloudinary.
    image_public_id: {
      type: String,
      required: true,
      select: false,
    },
    // متاح للبيع؟ عند false يظهر للاعب كـ "غير متاح حالياً" دون زر شراء فعّال.
    isAvailable: {
      type: Boolean,
      default: true,
    },
    // ترتيب العرض داخل المتجر (سحب وإفلات). الافتراضي 0.
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyId = ret.academyId?.toString();
        delete ret.image_public_id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

storeProductSchema.index({ academyId: 1, order: 1, created_at: -1 });

const StoreProduct = mongoose.model('StoreProduct', storeProductSchema);
module.exports = StoreProduct;
