const mongoose = require('mongoose');

// عرض / خصم يظهر في صفحة اللاعب. academyIds فارغة = كل الفروع.
// يظهر للاعب من startDate حتى endDate (شامل) ثم يختفي تلقائياً.
const offerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'عنوان العرض مطلوب'],
      trim: true,
      maxlength: [120, 'العنوان لا يمكن أن يتجاوز 120 حرف'],
    },
    details: {
      type: String,
      default: '',
      trim: true,
      maxlength: [2000, 'التفاصيل لا يمكن أن تتجاوز 2000 حرف'],
    },
    image_url: { type: String, default: null },
    image_public_id: { type: String, default: null, select: false },
    // نسبة (%) أو مبلغ — اختياري.
    discountType: {
      type: String,
      enum: { values: ['percent', 'amount'], message: 'نوع الخصم غير صحيح' },
      default: null,
    },
    discountValue: {
      type: Number,
      default: null,
      min: [0, 'قيمة الخصم لا يمكن أن تكون سالبة'],
    },
    startDate: { type: Date, required: [true, 'تاريخ البداية مطلوب'] },
    endDate: {
      type: Date,
      required: [true, 'تاريخ النهاية مطلوب'],
      validate: {
        validator: function (v) {
          return !this.startDate || v >= this.startDate;
        },
        message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية',
      },
    },
    academyIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Academy' }],
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyIds = (ret.academyIds || []).map((id) => id.toString());
        ret.createdBy = ret.createdBy ? ret.createdBy.toString() : null;
        delete ret.image_public_id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

offerSchema.index({ isActive: 1, endDate: 1 });
offerSchema.index({ academyIds: 1 });

module.exports = mongoose.model('Offer', offerSchema);
