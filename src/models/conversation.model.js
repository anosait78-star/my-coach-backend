const mongoose = require('mongoose');

// محادثة نصية بين لاعب وأكاديميته. محادثة واحدة فريدة لكل (أكاديمية، لاعب).
// اللاعب لا يراسل إلا أكاديميته، والأكاديمية ترد على لاعبيها فقط.
const conversationSchema = new mongoose.Schema(
  {
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
    lastMessage: { type: String, default: '' },
    lastMessageAt: { type: Date, default: null },
    // عدد الرسائل غير المقروءة من كل جهة.
    unreadForPlayer: { type: Number, default: 0 },
    unreadForAcademy: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyId = ret.academyId?.toString?.() ?? ret.academyId;
        if (ret.playerId && typeof ret.playerId === 'object' && ret.playerId._id !== undefined) {
          ret.playerId._id = ret.playerId._id?.toString();
        } else if (ret.playerId) {
          ret.playerId = ret.playerId.toString();
        }
        delete ret.__v;
        return ret;
      },
    },
  }
);

conversationSchema.index({ academyId: 1, playerId: 1 }, { unique: true });
conversationSchema.index({ academyId: 1, lastMessageAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);
module.exports = Conversation;
