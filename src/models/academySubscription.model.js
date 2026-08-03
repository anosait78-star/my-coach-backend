const mongoose = require('mongoose');

// اشتراك المنصة (SaaS): وثيقة واحدة لكل أكاديمية تحدّد علاقتها بـ Nosait.
// ⚠️ هذا مختلف تماماً عن موديل Subscription القائم الخاص بمدفوعات اللاعبين.
// - trial   : فترة تجريبية (7 أيام، 7 لاعبين).
// - active  : اشتراك مدفوع فعّال (شهر/سنة) بحد لاعبين مُحدّد.
// - expired : انتهى (تجريبي أو مدفوع) — قراءة فقط، تُمنع الكتابة.
// - suspended: مُعلَّق يدوياً من الإدارة — قراءة فقط.

const historyEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: [
        'CREATED_TRIAL', 'ACTIVATED', 'UPDATED', 'SUSPENDED', 'REACTIVATED', 'MIGRATED',
        // Player Portal feature toggle (إضافي — لا يغيّر القيم القديمة)
        'PORTAL_ENABLED', 'PORTAL_DISABLED',
      ],
      required: true,
    },
    plan: { type: String, enum: ['trial', 'month', 'year', 'legacy'] },
    maxPlayers: { type: Number },
    startDate: { type: Date },
    endDate: { type: Date },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    changedByName: { type: String, default: '' },
    note: { type: String, default: '' },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const academySubscriptionSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
      unique: true,
    },
    status: {
      type: String,
      enum: {
        values: ['trial', 'active', 'expired', 'suspended'],
        message: 'حالة الاشتراك غير صحيحة',
      },
      default: 'trial',
    },
    plan: {
      type: String,
      enum: {
        values: ['trial', 'month', 'year', 'legacy'],
        message: 'نوع الاشتراك غير صحيح',
      },
      default: 'trial',
    },
    maxPlayers: {
      type: Number,
      required: true,
      min: [0, 'الحد الأقصى للاعبين لا يمكن أن يكون سالباً'],
      default: 7,
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endDate: {
      type: Date,
      required: true,
    },
    // مدة الاشتراك بالأشهر (1 | 3 | 6 | 12) — حقل اختياري إضافي لعرض المدة
    // الدقيقة في لوحة الإدارة. الاشتراكات القديمة لا تملكه (undefined) وتُشتق
    // مدتها من الباقة (شهر/سنة) عند العرض. لا يؤثر على أي منطق كتابة/انتهاء.
    durationMonths: {
      type: Number,
    },
    // ميزة بوابة اللاعب (Player Portal): حسابات دخول اللاعبين متاحة فقط
    // عند تفعيلها. false افتراضياً — الأكاديميات الجديدة تُفعَّل لها أثناء
    // التسجيل (trial)، والقديمة تبقى معطّلة حتى يفعّلها Super Admin.
    playerPortalEnabled: {
      type: Boolean,
      default: false,
    },
    history: {
      type: [historyEntrySchema],
      default: [],
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyId = ret.academyId?.toString?.() ?? ret.academyId;
        delete ret.__v;
        return ret;
      },
    },
  }
);

academySubscriptionSchema.index({ status: 1 });
academySubscriptionSchema.index({ endDate: 1 });

// الحالة الفعلية: إذا مرّ endDate والحالة trial/active فهي منطقياً expired.
// (لا نعدّل قاعدة البيانات هنا — هذا حساب لحظي آمن للقراءة والحماية.)
academySubscriptionSchema.methods.effectiveStatus = function () {
  if (this.status === 'suspended') return 'suspended';
  if (this.status === 'expired') return 'expired';
  if (this.endDate && new Date() > this.endDate) return 'expired';
  return this.status; // trial أو active
};

// هل يُسمح بعمليات الكتابة؟ (كتابة = ليست expired/suspended)
academySubscriptionSchema.methods.isWritable = function () {
  const s = this.effectiveStatus();
  return s === 'trial' || s === 'active';
};

// هل بوابة اللاعب فعّالة الآن؟ تتطلب: الميزة مفعّلة + اشتراك حي (trial/active).
// انتهاء الاشتراك (حتى التجريبي) يوقف البوابة تلقائياً.
academySubscriptionSchema.methods.isPlayerPortalActive = function () {
  return this.playerPortalEnabled === true && this.isWritable();
};

// الأيام المتبقية حتى نهاية الاشتراك (0 إذا انتهى).
academySubscriptionSchema.virtual('daysRemaining').get(function () {
  if (!this.endDate) return 0;
  const ms = new Date(this.endDate).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / (1000 * 60 * 60 * 24));
});

const AcademySubscription = mongoose.model('AcademySubscription', academySubscriptionSchema);
module.exports = AcademySubscription;
