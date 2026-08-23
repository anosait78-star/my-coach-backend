const mongoose = require('mongoose');
const { KIT_SIZES } = require('../utils/kitSizes');

// حجز طقم فريق. عند إنشاء اللاعب للحجز تكون الحالة pending_review — لا يُعتبر
// مثبَّتاً في سجل الحجوزات الرسمي حتى يراجعه المدير ويوافق عليه (وقد يعدّل
// البيانات وحالة الدفع أولاً). حجوزات المدير المباشرة تُنشأ approved فوراً.
const kitBookingSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: true,
    },
    kitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamKit',
      required: true,
    },
    // لقطة وقت الحجز (لا تتغيّر بتغيّر الطقم لاحقاً).
    kitName: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'EGP', trim: true },

    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: true,
    },
    playerName: { type: String, required: true, trim: true },

    shirtName: {
      type: String,
      required: [true, 'الاسم على التيشرت مطلوب'],
      trim: true,
      maxlength: [30, 'الاسم على التيشرت لا يمكن أن يتجاوز 30 حرف'],
    },
    shirtNumber: {
      type: Number,
      required: [true, 'الرقم على التيشرت مطلوب'],
      min: [0, 'الرقم غير صحيح'],
      max: [999, 'الرقم غير صحيح'],
    },
    size: {
      type: String,
      enum: KIT_SIZES,
      required: [true, 'المقاس مطلوب'],
    },

    // صورة إيصال الدفع التي يرفعها اللاعب مع الحجز، ليراجعها المدير قبل
    // الموافقة. حجوزات المدير المباشرة لا إيصال لها (null).
    receipt_url: {
      type: String,
      default: null,
    },
    // مخفي عن العميل؛ يُستخدم لحذف الصورة من Cloudinary.
    receipt_public_id: {
      type: String,
      default: null,
      select: false,
    },

    status: {
      type: String,
      enum: ['pending_review', 'approved', 'rejected'],
      default: 'pending_review',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid'],
      default: 'unpaid',
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: [0, 'المبلغ لا يمكن أن يكون سالباً'],
    },

    // 'player' = طلب أنشأه اللاعب عبر بوابته، 'manager' = أضافه المدير مباشرة.
    source: {
      type: String,
      enum: ['player', 'manager'],
      default: 'player',
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyId = ret.academyId?.toString();
        ret.kitId = ret.kitId?.toString();
        ret.playerId = ret.playerId?.toString();
        ret.reviewedBy = ret.reviewedBy?.toString() || null;
        delete ret.receipt_public_id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

kitBookingSchema.index({ academyId: 1, status: 1, created_at: -1 });

const KitBooking = mongoose.model('KitBooking', kitBookingSchema);
module.exports = KitBooking;
