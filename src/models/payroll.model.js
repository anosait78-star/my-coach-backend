const mongoose = require('mongoose');

// سجل راتب شهري لكل موظف. نحفظ "لقطة" (snapshot) من بيانات الموظف وقت التوليد
// حتى لا يتأثر تاريخ الرواتب بأي تعديل لاحق على بيانات الموظف، ويمكن إعادة
// توليده (recalculate) ما دام لم يُدفع بعد.
const payrollSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: [true, 'معرّف الموظف مطلوب'],
    },
    month: {
      type: String,
      required: [true, 'الشهر مطلوب'],
      match: [/^\d{4}-\d{2}$/, 'صيغة الشهر غير صحيحة'],
    },
    baseSalary: {
      type: Number,
      required: true,
      min: 0,
    },
    monthlyAttendanceTarget: {
      type: Number,
      required: true,
      min: 1,
    },
    presentCount: {
      type: Number,
      required: true,
      min: 0,
    },
    absentCount: {
      type: Number,
      required: true,
      min: 0,
    },
    deductionType: {
      type: String,
      required: true,
      enum: ['percentage', 'fixed'],
    },
    deductionValue: {
      type: Number,
      required: true,
      min: 0,
    },
    deductionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    netSalary: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid'],
      default: 'pending',
    },
    paidAt: {
      type: Date,
      default: null,
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        if (ret.staffId && ret.staffId._id) {
          ret.staffId._id = ret.staffId._id.toString();
        } else if (ret.staffId) {
          ret.staffId = ret.staffId.toString();
        }
        ret.academyId = ret.academyId?.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

payrollSchema.index({ staffId: 1, month: 1 }, { unique: true });
payrollSchema.index({ academyId: 1, month: 1 });

const Payroll = mongoose.model('Payroll', payrollSchema);
module.exports = Payroll;
