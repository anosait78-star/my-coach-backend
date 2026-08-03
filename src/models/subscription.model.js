const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: [true, 'معرّف اللاعب مطلوب'],
    },
    type: {
      type: String,
      enum: {
        values: ['NEW_SUBSCRIPTION', 'RENEWAL'],
        message: 'نوع الاشتراك يجب أن يكون NEW_SUBSCRIPTION أو RENEWAL',
      },
      required: [true, 'نوع الاشتراك مطلوب'],
    },
    amount: {
      type: Number,
      required: [true, 'مبلغ الاشتراك مطلوب'],
      min: [0, 'مبلغ الاشتراك لا يمكن أن يكون سالباً'],
    },
    startDate: {
      type: Date,
      required: [true, 'تاريخ بداية الاشتراك مطلوب'],
    },
    endDate: {
      type: Date,
      required: [true, 'تاريخ نهاية الاشتراك مطلوب'],
      validate: {
        validator: function (value) {
          return value > this.startDate;
        },
        message: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية',
      },
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'الملاحظات لا يمكن أن تتجاوز 500 حرف'],
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyId = ret.academyId?.toString();

        // إذا كان playerId مُحمَّلاً (populated object) نحتفظ به كـ object
        // ونحوّل فقط الـ _id الداخلي إلى string
        // إذا كان ObjectId عادياً نحوّله إلى string
        if (ret.playerId && typeof ret.playerId === 'object' && ret.playerId._id !== undefined) {
          // populated — stringify the nested _id only
          ret.playerId._id = ret.playerId._id?.toString();
        } else if (ret.playerId) {
          ret.playerId = ret.playerId.toString();
        }

        delete ret.__v;
        return ret;
      },
    },
  }
);

// Virtuals
subscriptionSchema.virtual('isActive').get(function () {
  return new Date() <= this.endDate;
});

subscriptionSchema.virtual('status').get(function () {
  return new Date() <= this.endDate ? 'active' : 'expired';
});

// Indexes
subscriptionSchema.index({ playerId: 1 });
subscriptionSchema.index({ academyId: 1 });
subscriptionSchema.index({ academyId: 1, playerId: 1 });
subscriptionSchema.index({ endDate: 1 });
subscriptionSchema.index({ type: 1 });

const Subscription = mongoose.model('Subscription', subscriptionSchema);
module.exports = Subscription;
