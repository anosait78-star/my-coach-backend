const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    playerCode: {
      type: String,
      unique: true,
      immutable: true,
    },
    fullName: {
      type: String,
      required: [true, 'الاسم الكامل مطلوب'],
      trim: true,
      minlength: [2, 'الاسم يجب أن يكون حرفين على الأقل'],
      maxlength: [150, 'الاسم لا يمكن أن يتجاوز 150 حرف'],
    },
    birthDate: {
      type: Date,
      required: [true, 'تاريخ الميلاد مطلوب'],
    },
    image_url: {
      type: String,
      default: null,
    },
    image_public_id: {
      type: String,
      default: null,
      select: false,
    },
    parentName: {
      type: String,
      required: [true, 'اسم ولي الأمر مطلوب'],
      trim: true,
      minlength: [2, 'اسم ولي الأمر يجب أن يكون حرفين على الأقل'],
      maxlength: [100, 'اسم ولي الأمر لا يمكن أن يتجاوز 100 حرف'],
    },
    parentRelationship: {
      type: String,
      required: [true, 'صلة القرابة مطلوبة'],
      enum: {
        values: ['أب', 'أم', 'أخ', 'أخت', 'جد', 'جدة', 'عم', 'عمة', 'خال', 'خالة', 'وصي'],
        message: 'صلة القرابة غير صحيحة',
      },
    },
    parentJob: {
      type: String,
      trim: true,
      maxlength: [100, 'وظيفة ولي الأمر لا يمكن أن تتجاوز 100 حرف'],
    },
    parentPhone: {
      type: String,
      required: [true, 'رقم هاتف ولي الأمر مطلوب'],
      trim: true,
      match: [/^[0-9+\-\s()]{7,20}$/, 'رقم الهاتف غير صحيح'],
    },
    playerPhone: {
      type: String,
      trim: true,
      // اختياري — يُقبل فارغاً، ويُتحقق من الصيغة فقط عند الإدخال
      validate: {
        validator: function (v) {
          if (v === undefined || v === null || v === '') return true;
          return /^[0-9+\-\s()]{7,20}$/.test(v);
        },
        message: 'رقم هاتف اللاعب غير صحيح',
      },
    },
    notes: {
      type: String,
      maxlength: [500, 'الملاحظات لا يمكن أن تتجاوز 500 حرف'],
    },
    // الرياضة الخاصة باللاعب — تُعيَّن تلقائياً إذا كانت الأكاديمية ذات رياضة واحدة،
    // وتكون إلزامية من الواجهة إذا كانت الأكاديمية متعددة الرياضات.
    sport: {
      type: String,
      trim: true,
      default: null,
    },
    // المجموعة التدريبية الخاصة باللاعب.
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    // أيام حضور اللاعب الأسبوعية (Multi-select).
    attendanceDays: {
      type: [String],
      default: [],
      validate: {
        validator: function (arr) {
          const valid = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
          return !Array.isArray(arr) || arr.every((d) => valid.includes(d));
        },
        message: 'أيام الحضور غير صحيحة',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // ── تسجيل ذاتي للاعبين (طلبات الانضمام) ──
    // registrationStatus: حالة مراجعة الطلب. اللاعبون الذين ينشئهم الأدمن مباشرة
    // (registrationSource='admin') تكون حالتهم 'approved' افتراضياً بلا أي تأثير.
    registrationStatus: {
      type: String,
      enum: {
        values: ['approved', 'pending', 'rejected'],
        message: 'حالة التسجيل غير صحيحة',
      },
      default: 'approved',
    },
    registrationSource: {
      type: String,
      enum: {
        values: ['admin', 'self'],
        message: 'مصدر التسجيل غير صحيح',
      },
      default: 'admin',
    },
    // الفرع الذي اختاره اللاعب عند التسجيل الذاتي (نصي، للعرض فقط).
    branch: {
      type: String,
      trim: true,
      default: null,
    },
    receipt_url: {
      type: String,
      default: null,
    },
    receipt_public_id: {
      type: String,
      default: null,
      select: false,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [500, 'سبب الرفض لا يمكن أن يتجاوز 500 حرف'],
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
        if (ret.groupId) ret.groupId = ret.groupId.toString();
        delete ret.__v;
        delete ret.image_public_id;
        delete ret.receipt_public_id;
        return ret;
      },
    },
  }
);

// طلبات الانضمام المعلّقة لكل أكاديمية — تُستعلم بكثرة من شاشة "طلبات الانضمام".
playerSchema.index({ academyId: 1, registrationStatus: 1 });

// Indexes
playerSchema.index({ academyId: 1 });
playerSchema.index({ academyId: 1, isActive: 1 });
playerSchema.index({ academyId: 1, sport: 1 });
playerSchema.index({ academyId: 1, groupId: 1 });
playerSchema.index(
  { fullName: 'text', playerCode: 'text', parentPhone: 'text' },
  { name: 'player_text_search' }
);

// Static method to generate next playerCode
playerSchema.statics.generatePlayerCode = async function () {
  const lastPlayer = await this.findOne({}, { playerCode: 1 }).sort({ playerCode: -1 });
  if (!lastPlayer) return 'Y-0001';
  const lastNum = parseInt(lastPlayer.playerCode.split('-')[1], 10);
  const nextNum = lastNum + 1;
  return 'Y-' + String(nextNum).padStart(4, '0');
};

// Pre-validate hook: auto-assign playerCode for new documents
playerSchema.pre('validate', async function (next) {
  if (this.isNew && !this.playerCode) {
    this.playerCode = await this.constructor.generatePlayerCode();
  }
  next();
});

const Player = mongoose.model('Player', playerSchema);

// شرط "اللاعبون المعتمدون فقط" — يُدمج في كل استعلام يعرض أو يعدّ اللاعبين،
// حتى لا يظهر طلب انضمام معلّق أو مرفوض في قوائم اللاعبين ولا في الإحصائيات.
// نستخدم $nin بدل المساواة بـ 'approved' عمداً: أي وثيقة قديمة بلا الحقل
// (الافتراضي لا يُطبَّق بأثر رجعي) تبقى ظاهرة بدل أن تختفي بصمت.
Player.APPROVED_ONLY = Object.freeze({
  registrationStatus: { $nin: ['pending', 'rejected'] },
});

module.exports = Player;
