const mongoose = require('mongoose');

// عائلة حسابات لاعبين دمجها السوبر أدمن (إخوة مثلاً — قد يكونون في فروع
// مختلفة). العضوية نفسها مخزّنة على PlayerAccount.familyId حتى يكون الحساب
// في عائلة واحدة فقط حتماً.
const familySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: '',
      trim: true,
      maxlength: [100, 'اسم العائلة لا يمكن أن يتجاوز 100 حرف'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model('Family', familySchema);
