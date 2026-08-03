const mongoose = require('mongoose');

// إشعار دائم موجّه لمستلم واحد: إما أكاديمية (User) أو لاعب (PlayerAccount).
// يُنشأ عند: رسالة جديدة، حضور، غياب، تقييم، تجديد اشتراك، قرب انتهاء الاشتراك.
const notificationSchema = new mongoose.Schema(
  {
    // إلى من: 'academy' (يُعرض لمدراء الأكاديمية) أو 'player'.
    recipientType: {
      type: String,
      enum: ['academy', 'player'],
      required: true,
    },
    // معرّف المستلم: playerId للاعب، أو academyId عند recipientType=academy
    // (نوجّه لكل مدراء الأكاديمية عبر academyId بدل فرد بعينه).
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: true,
    },
    type: {
      type: String,
      enum: [
        'NEW_MESSAGE',
        'ATTENDANCE_PRESENT',
        'ATTENDANCE_ABSENT',
        'EVALUATION_ADDED',
        'SUBSCRIPTION_RENEWED',
        'SUBSCRIPTION_EXPIRING',
      ],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, default: '', trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    isRead: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.recipientId = ret.recipientId?.toString?.() ?? ret.recipientId;
        ret.academyId = ret.academyId?.toString?.() ?? ret.academyId;
        delete ret.__v;
        return ret;
      },
    },
  }
);

notificationSchema.index({ recipientType: 1, recipientId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ academyId: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
