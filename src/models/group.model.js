const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    name: {
      type: String,
      required: [true, 'اسم المجموعة مطلوب'],
      trim: true,
      minlength: [2, 'الاسم يجب أن يكون حرفين على الأقل'],
      maxlength: [150, 'الاسم لا يمكن أن يتجاوز 150 حرف'],
    },
    capacity: {
      type: Number,
      min: [1, 'السعة القصوى يجب أن تكون 1 على الأقل'],
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // ترتيب العرض داخل الأكاديمية (سحب وإفلات). إضافي ومتوافق — الافتراضي 0.
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
        delete ret.__v;
        return ret;
      },
    },
  }
);

groupSchema.index({ academyId: 1 });
groupSchema.index({ academyId: 1, order: 1 });

const Group = mongoose.model('Group', groupSchema);
module.exports = Group;
