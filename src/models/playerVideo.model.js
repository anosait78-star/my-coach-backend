const mongoose = require('mongoose');

// إعجاب واحد على فيديو. مضمَّن داخل الفيديو (العدد صغير بطبيعته: لاعب واحد
// + مدراء أكاديميته)، فلا داعي لمجموعة مستقلة.
const likeSchema = new mongoose.Schema(
  {
    // 'player' = اللاعب صاحب البروفايل، 'academy' = أحد مدراء الأكاديمية.
    authorType: { type: String, enum: ['player', 'academy'], required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    authorName: { type: String, default: '', trim: true },
    created_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// فيديو في بروفايل لاعب. تضيفه إدارة الأكاديمية كرابط خارجي (يوتيوب/درايف)
// — لا رفع ملفات. مرتبط حتمياً بـ academyId + playerId، فلا يراه إلا صاحب
// البروفايل وإدارة أكاديميته (يُفرَض في الـ controller).
const playerVideoSchema = new mongoose.Schema(
  {
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: [true, 'معرّف اللاعب مطلوب'],
    },
    title: {
      type: String,
      required: [true, 'العنوان مطلوب'],
      trim: true,
      minlength: [1, 'العنوان مطلوب'],
      maxlength: [150, 'العنوان لا يمكن أن يتجاوز 150 حرف'],
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: [1000, 'الوصف لا يمكن أن يتجاوز 1000 حرف'],
    },
    // رابط الفيديو بعد التحقق والتوحيد (parseVideoLink).
    url: {
      type: String,
      required: [true, 'رابط الفيديو مطلوب'],
      trim: true,
    },
    provider: {
      type: String,
      enum: ['youtube', 'drive'],
      required: true,
    },
    // معرّف فيديو يوتيوب (null لغير يوتيوب) — يُشتق منه المصغّر.
    videoKey: { type: String, default: null },
    thumbnailUrl: { type: String, default: '' },
    // من أضاف الفيديو من الإدارة (للتوثيق والعرض).
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '', trim: true },
    likes: { type: [likeSchema], default: [] },
    // عدّاد مُشتق يُحدَّث مع كل تعليق — يتفادى count استعلاماً لكل فيديو.
    commentsCount: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyId = ret.academyId?.toString?.() ?? ret.academyId;
        ret.playerId = ret.playerId?.toString?.() ?? ret.playerId;
        ret.createdBy = ret.createdBy?.toString?.() ?? ret.createdBy;
        // لا نسرّب قائمة المعجِبين للعميل — العدد فقط، و likedByMe يضيفه
        // الـ controller حسب هوية الطالب.
        ret.likesCount = Array.isArray(ret.likes) ? ret.likes.length : 0;
        delete ret.likes;
        delete ret.__v;
        return ret;
      },
    },
  }
);

playerVideoSchema.index({ playerId: 1, created_at: -1 });
playerVideoSchema.index({ academyId: 1, created_at: -1 });

const PlayerVideo = mongoose.model('PlayerVideo', playerVideoSchema);
module.exports = PlayerVideo;
