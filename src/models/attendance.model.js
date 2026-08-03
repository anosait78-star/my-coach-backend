const mongoose = require('mongoose');

// سجل حضور اللاعب. نُخزّن سجلات "الحضور" فقط — الغياب يُحسب اشتقاقاً في التقارير
// من خلال مقارنة أيام تدريب اللاعب (attendanceDays) بأيام الحضور المسجّلة، حتى
// لا نُنشئ كتابات زائدة ونُحافظ على الأداء.
const attendanceSchema = new mongoose.Schema(
  {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: [true, 'معرّف اللاعب مطلوب'],
    },
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    sport: {
      type: String,
      trim: true,
      default: null,
    },
    // اليوم المحلي بصيغة 'YYYY-MM-DD' كما يُرسله الجهاز — أساس منع التكرار اليومي.
    date: {
      type: String,
      required: [true, 'تاريخ الحضور مطلوب'],
      match: [/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة'],
    },
    // وقت التسجيل المحلي بصيغة 'HH:mm'.
    time: {
      type: String,
      required: [true, 'وقت الحضور مطلوب'],
      match: [/^\d{2}:\d{2}$/, 'صيغة الوقت غير صحيحة'],
    },
    // طابع زمني دقيق للترتيب الزمني (مستقل عن صيغة date/time النصية).
    timestamp: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: {
        values: ['present'],
        message: 'حالة الحضور غير صحيحة',
      },
      default: 'present',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        // playerId قد يكون مُعبَّأً (populated) أو ObjectId خام
        if (ret.playerId && ret.playerId._id) {
          ret.playerId._id = ret.playerId._id.toString();
        } else if (ret.playerId) {
          ret.playerId = ret.playerId.toString();
        }
        ret.academyId = ret.academyId?.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

// منع تكرار حضور نفس اللاعب في نفس اليوم على مستوى قاعدة البيانات
// (حماية مؤكدة حتى عند تسابق الطلبات).
attendanceSchema.index({ playerId: 1, date: 1 }, { unique: true });
// تسريع السجل والتقارير.
attendanceSchema.index({ academyId: 1, date: 1 });
attendanceSchema.index({ academyId: 1, sport: 1, date: 1 });

const Attendance = mongoose.model('Attendance', attendanceSchema);
module.exports = Attendance;
