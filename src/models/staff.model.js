const mongoose = require('mongoose');

const WEEKDAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

const staffSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    fullName: {
      type: String,
      required: [true, 'اسم الموظف مطلوب'],
      trim: true,
      minlength: [2, 'الاسم يجب أن يكون حرفين على الأقل'],
      maxlength: [150, 'الاسم لا يمكن أن يتجاوز 150 حرف'],
    },
    position: {
      type: String,
      required: [true, 'الوظيفة مطلوبة'],
      trim: true,
      maxlength: [100, 'الوظيفة لا يمكن أن تتجاوز 100 حرف'],
    },
    phone: {
      type: String,
      required: [true, 'رقم الهاتف مطلوب'],
      trim: true,
      match: [/^[0-9+\-\s()]{7,20}$/, 'رقم الهاتف غير صحيح'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      validate: {
        validator: function (v) {
          if (v === undefined || v === null || v === '') return true;
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: 'البريد الإلكتروني غير صحيح',
      },
    },
    photo_url: {
      type: String,
      default: null,
    },
    photo_public_id: {
      type: String,
      default: null,
      select: false,
    },
    hireDate: {
      type: Date,
      required: [true, 'تاريخ التعيين مطلوب'],
    },
    baseSalary: {
      type: Number,
      default: null,
      min: [0, 'الراتب الأساسي لا يمكن أن يكون سالباً'],
    },
    workingDays: {
      type: [String],
      default: [],
      validate: {
        validator: function (arr) {
          return Array.isArray(arr) && arr.length > 0 && arr.every((d) => WEEKDAYS.includes(d));
        },
        message: 'أيام العمل غير صحيحة',
      },
    },
    monthlyAttendanceTarget: {
      type: Number,
      required: [true, 'عدد أيام الحضور المطلوبة مطلوب'],
      min: [1, 'عدد أيام الحضور المطلوبة يجب أن يكون 1 على الأقل'],
    },
    deductionType: {
      type: String,
      required: [true, 'نوع الخصم مطلوب'],
      enum: {
        values: ['percentage', 'fixed'],
        message: 'نوع الخصم غير صحيح',
      },
    },
    deductionValue: {
      type: Number,
      required: [true, 'قيمة الخصم مطلوبة'],
      min: [0, 'قيمة الخصم لا يمكن أن تكون سالبة'],
      validate: {
        validator: function (v) {
          if (this.deductionType === 'percentage') return v <= 100;
          return true;
        },
        message: 'نسبة الخصم لا يمكن أن تتجاوز 100%',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
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
        delete ret.photo_public_id;
        return ret;
      },
    },
  }
);

staffSchema.index({ academyId: 1 });
staffSchema.index({ academyId: 1, isActive: 1 });

staffSchema.statics.WEEKDAYS = WEEKDAYS;

const Staff = mongoose.model('Staff', staffSchema);
module.exports = Staff;
