const mongoose = require('mongoose');

const CATEGORIES = [
  'rent', 'electricity', 'water', 'sports_equipment',
  'salaries', 'maintenance', 'transport', 'other',
];

const expenseSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    name: {
      type: String,
      required: [true, 'اسم المصروف مطلوب'],
      trim: true,
      maxlength: [150, 'اسم المصروف لا يمكن أن يتجاوز 150 حرف'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'الوصف لا يمكن أن يتجاوز 500 حرف'],
      default: null,
    },
    amount: {
      type: Number,
      required: [true, 'المبلغ مطلوب'],
      min: [0, 'المبلغ لا يمكن أن يكون سالباً'],
    },
    date: {
      type: String,
      required: [true, 'تاريخ المصروف مطلوب'],
      match: [/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة'],
    },
    category: {
      type: String,
      required: [true, 'تصنيف المصروف مطلوب'],
      enum: {
        values: CATEGORIES,
        message: 'تصنيف المصروف غير صحيح',
      },
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

expenseSchema.index({ academyId: 1, date: 1 });
expenseSchema.index({ academyId: 1, category: 1 });

expenseSchema.statics.CATEGORIES = CATEGORIES;

const Expense = mongoose.model('Expense', expenseSchema);
module.exports = Expense;
