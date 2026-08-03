const mongoose = require('mongoose');

// رسالة نصية فقط داخل محادثة. لا صور/PDF/صوت/فيديو/ملفات — نص خالص.
const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
    },
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
    // من أرسل الرسالة: اللاعب أم الأكاديمية.
    senderType: {
      type: String,
      enum: ['player', 'academy'],
      required: true,
    },
    // معرّف المُرسِل الفعلي (PlayerAccount للاعب، User للأكاديمية) للتوثيق.
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    text: {
      type: String,
      required: [true, 'نص الرسالة مطلوب'],
      trim: true,
      minlength: [1, 'الرسالة فارغة'],
      maxlength: [1000, 'الرسالة لا يمكن أن تتجاوز 1000 حرف'],
    },
    readAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.conversationId = ret.conversationId?.toString?.() ?? ret.conversationId;
        ret.academyId = ret.academyId?.toString?.() ?? ret.academyId;
        ret.playerId = ret.playerId?.toString?.() ?? ret.playerId;
        ret.senderId = ret.senderId?.toString?.() ?? ret.senderId;
        delete ret.__v;
        return ret;
      },
    },
  }
);

messageSchema.index({ conversationId: 1, created_at: 1 });

const Message = mongoose.model('Message', messageSchema);
module.exports = Message;
