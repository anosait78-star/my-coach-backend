const mongoose = require('mongoose');

// طلب شراء أنشأه لاعب من متجر أكاديميته. نحتفظ بلقطة (snapshot) لاسم المنتج
// وسعره وعملته وقت الطلب حتى يبقى السجل صحيحاً لو عُدِّل المنتج أو حُذف لاحقاً.
const storeOrderSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StoreProduct',
      required: true,
    },
    // لقطة وقت الطلب (لا تتغيّر بتغيّر المنتج).
    productName: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'EGP', trim: true },

    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: true,
    },
    playerName: { type: String, required: true, trim: true },

    // دورة حياة الطلب — يديرها المدير يدوياً.
    status: {
      type: String,
      enum: ['pending', 'contacted', 'completed', 'cancelled'],
      default: 'pending',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyId = ret.academyId?.toString();
        ret.productId = ret.productId?.toString();
        ret.playerId = ret.playerId?.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

storeOrderSchema.index({ academyId: 1, status: 1, created_at: -1 });

const StoreOrder = mongoose.model('StoreOrder', storeOrderSchema);
module.exports = StoreOrder;
