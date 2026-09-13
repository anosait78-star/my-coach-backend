const mongoose = require('mongoose');

// طلب تجديد اشتراك يرسله اللاعب من بوابته مع صورة إيصال الدفع. يراجعه
// السوبر أدمن: الموافقة تعني أنه سجّل اشتراك التجديد فعلاً، والرفض مع سبب.
const renewalRequestSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: true,
    },
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: true,
    },
    receipt_url: { type: String, required: true },
    // مخفي عن العميل؛ يُستخدم لحذف الصورة من Cloudinary.
    receipt_public_id: { type: String, default: null, select: false },
    note: {
      type: String,
      default: '',
      trim: true,
      maxlength: [500, 'الملاحظة لا يمكن أن تتجاوز 500 حرف'],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: [500, 'سبب الرفض لا يمكن أن يتجاوز 500 حرف'],
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        delete ret.receipt_public_id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

renewalRequestSchema.index({ status: 1, created_at: -1 });
renewalRequestSchema.index({ playerId: 1, created_at: -1 });

module.exports = mongoose.model('RenewalRequest', renewalRequestSchema);
