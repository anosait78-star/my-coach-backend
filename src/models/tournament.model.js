const mongoose = require('mongoose');

// بطولة (دوري / كأس / مجموعات ثم كأس) — فردية أو جماعية.
const tournamentSchema = new mongoose.Schema(
  {
    // الفروع المشاركة (كل فرع = Academy). حساب الفرع يُنشئ لفرعه فقط،
    // والحساب الرئيسي (super_admin) يختار فرعاً أو أكثر.
    academyIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Academy' }],
      validate: { validator: (a) => Array.isArray(a) && a.length > 0, message: 'يجب اختيار فرع واحد على الأقل' },
    },
    name: {
      type: String,
      required: [true, 'اسم البطولة مطلوب'],
      trim: true,
      minlength: [2, 'اسم البطولة يجب أن يكون حرفين على الأقل'],
      maxlength: [150, 'اسم البطولة لا يمكن أن يتجاوز 150 حرف'],
    },
    sport: { type: String, trim: true, default: null },
    ageGroup: { type: String, trim: true, default: '' },
    startDate: { type: String, default: null, match: [/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة'] },
    endDate: { type: String, default: null, match: [/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة'] },
    notes: { type: String, trim: true, default: '', maxlength: [1000, 'الملاحظات طويلة جداً'] },

    // فردي: كل مشارك لاعب واحد — جماعي: كل مشارك فريق من عدة لاعبين.
    participantType: {
      type: String,
      enum: { values: ['individual', 'team'], message: 'نوع المشاركة غير صحيح' },
      required: [true, 'نوع المشاركة مطلوب'],
    },
    format: {
      type: String,
      enum: { values: ['league', 'knockout', 'groups_knockout'], message: 'نظام البطولة غير صحيح' },
      required: [true, 'نظام البطولة مطلوب'],
    },
    // عشوائي: النظام يخلط المشاركين — موجّه: يتبع ترتيب (seed) الأدمن.
    drawMode: {
      type: String,
      enum: { values: ['random', 'directed'], message: 'طريقة القرعة غير صحيحة' },
      default: 'random',
    },

    // goals: نتيجة رقمية واحدة — sets: بالأشواط.
    scoring: {
      mode: { type: String, enum: ['goals', 'sets'], default: 'goals' },
      bestOf: { type: Number, default: 3, min: 1, max: 9 }, // عدد الأشواط (أفضل N)
      pointsPerSet: { type: Number, default: 11, min: 1, max: 100 },
      winByTwo: { type: Boolean, default: true },
      maxPointsPerSet: { type: Number, default: null }, // سقف اختياري
    },

    // قواعد الدوري / المجموعات.
    league: {
      winPoints: { type: Number, default: 3 },
      drawPoints: { type: Number, default: 1 },
      lossPoints: { type: Number, default: 0 },
      doubleRound: { type: Boolean, default: false }, // ذهاب وعودة
      allowDraws: { type: Boolean, default: true },
    },
    groups: {
      count: { type: Number, default: 2, min: 1, max: 16 },
      qualifiersPerGroup: { type: Number, default: 2, min: 1, max: 8 },
    },
    // التعادل في الكأس: ضربات ترجيح يحددها الأدمن.
    knockout: {
      penaltiesEnabled: { type: Boolean, default: true },
      penaltiesCount: { type: Number, default: 5, min: 1, max: 20 },
    },

    status: {
      type: String,
      enum: { values: ['draft', 'running', 'finished'], message: 'حالة البطولة غير صحيحة' },
      default: 'draft',
    },
    visibleToPlayers: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret._id = ret._id.toString();
        ret.academyIds = (ret.academyIds || []).map((id) => id.toString());
        ret.createdBy = ret.createdBy ? ret.createdBy.toString() : null;
        delete ret.__v;
        return ret;
      },
    },
  }
);

tournamentSchema.index({ academyIds: 1, status: 1 });

module.exports = mongoose.model('Tournament', tournamentSchema);
