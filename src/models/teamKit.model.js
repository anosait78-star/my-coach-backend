const mongoose = require('mongoose');
const { KIT_SIZES } = require('../utils/kitSizes');

// طقم الفريق: نسخة واحدة فعّالة لكل أكاديمية (يديرها المدير من الإجراءات
// السريعة). نفس نمط منتج المتجر (storeProduct.model.js) لكن بدون كتالوج —
// تحديث الطقم يستبدل بياناته بدل إنشاء نسخة جديدة.
const teamKitSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
      unique: true,
    },
    name: {
      type: String,
      required: [true, 'اسم الطقم مطلوب'],
      trim: true,
      minlength: [1, 'اسم الطقم مطلوب'],
      maxlength: [150, 'اسم الطقم لا يمكن أن يتجاوز 150 حرف'],
    },
    price: {
      type: Number,
      required: [true, 'سعر الطقم مطلوب'],
      min: [0, 'السعر لا يمكن أن يكون سالباً'],
    },
    image_url: {
      type: String,
      required: [true, 'صورة الطقم مطلوبة'],
    },
    // مخفي عن العميل؛ يُستخدم لحذف الصورة من Cloudinary.
    image_public_id: {
      type: String,
      required: true,
      select: false,
    },
    availableSizes: {
      type: [String],
      enum: KIT_SIZES,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'يجب اختيار مقاس واحد على الأقل',
      },
      required: true,
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

const TeamKit = mongoose.model('TeamKit', teamKitSchema);
module.exports = TeamKit;
