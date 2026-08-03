const mongoose = require('mongoose');

// سجل حضور/غياب الموظف. على عكس حضور اللاعبين، نُسجّل الغياب صراحةً
// لأن حساب الراتب يحتاج عدد غياب موثوق لكل شهر.
const staffAttendanceSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: [true, 'معرّف الموظف مطلوب'],
    },
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    date: {
      type: String,
      required: [true, 'تاريخ الحضور مطلوب'],
      match: [/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة'],
    },
    status: {
      type: String,
      required: [true, 'حالة الحضور مطلوبة'],
      enum: {
        values: ['present', 'absent'],
        message: 'حالة الحضور غير صحيحة',
      },
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    notes: {
      type: String,
      maxlength: [300, 'الملاحظات لا يمكن أن تتجاوز 300 حرف'],
      default: null,
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

staffAttendanceSchema.index({ staffId: 1, date: 1 }, { unique: true });
staffAttendanceSchema.index({ academyId: 1, date: 1 });

const StaffAttendance = mongoose.model('StaffAttendance', staffAttendanceSchema);
module.exports = StaffAttendance;
