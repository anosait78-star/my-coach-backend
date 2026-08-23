const mongoose = require('mongoose');

// تعليق نصّي على فيديو في بروفايل لاعب. يكتبه اللاعب صاحب البروفايل أو أحد
// مدراء أكاديميته. نص خالص — لا صور ولا مرفقات.
const playerVideoCommentSchema = new mongoose.Schema(
  {
    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlayerVideo',
      required: true,
    },
    // مكرَّران من الفيديو لتسهيل العزل والفهرسة دون populate.
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: true,
    },
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: true,
    },
    authorType: { type: String, enum: ['player', 'academy'], required: true },
    // PlayerAccount للاعب، User للأكاديمية.
    authorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    authorName: { type: String, default: '', trim: true },
    text: {
      type: String,
      required: [true, 'نص التعليق مطلوب'],
      trim: true,
      minlength: [1, 'التعليق فارغ'],
      maxlength: [1000, 'التعليق لا يمكن أن يتجاوز 1000 حرف'],
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.videoId = ret.videoId?.toString?.() ?? ret.videoId;
        ret.academyId = ret.academyId?.toString?.() ?? ret.academyId;
        ret.playerId = ret.playerId?.toString?.() ?? ret.playerId;
        ret.authorId = ret.authorId?.toString?.() ?? ret.authorId;
        delete ret.__v;
        return ret;
      },
    },
  }
);

playerVideoCommentSchema.index({ videoId: 1, created_at: 1 });

const PlayerVideoComment = mongoose.model(
  'PlayerVideoComment',
  playerVideoCommentSchema
);
module.exports = PlayerVideoComment;
