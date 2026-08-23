const mongoose = require('mongoose');

// سجل النشاط: يحفظ كل عملية يقوم بها مستخدمو الأكاديمية مع اسم المستخدم.
const activitySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
    },
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: true,
    },
    actionType: {
      type: String,
      required: true,
      enum: [
        'CREATE_PLAYER', 'UPDATE_PLAYER', 'DELETE_PLAYER',
        'ADD_SUBSCRIPTION', 'RENEW_SUBSCRIPTION', 'DELETE_SUBSCRIPTION',
        'ADD_EVALUATION', 'UPDATE_EVALUATION', 'DELETE_EVALUATION',
        'RECORD_ATTENDANCE',
        'ADD_USER', 'UPDATE_USER', 'DELETE_USER',
        'UPDATE_ACADEMY',
        'ADD_STAFF', 'UPDATE_STAFF', 'DELETE_STAFF',
        'MARK_STAFF_ATTENDANCE',
        'GENERATE_PAYROLL', 'MARK_PAYROLL_PAID',
        'ADD_EXPENSE', 'UPDATE_EXPENSE', 'DELETE_EXPENSE',
        // منصة SaaS (Nosait)
        'REGISTER_ACADEMY', 'ACTIVATE_SUBSCRIPTION', 'UPDATE_SUBSCRIPTION',
        // حسابات اللاعبين (Player Portal) — Audit Log
        'CREATE_PLAYER_ACCOUNT', 'CHANGE_PLAYER_PASSWORD', 'RESET_PLAYER_PASSWORD',
        'ENABLE_PLAYER_ACCOUNT', 'DISABLE_PLAYER_ACCOUNT',
        // المجموعات (Groups / Training cohorts)
        'CREATE_GROUP', 'UPDATE_GROUP', 'DELETE_GROUP', 'PLAYER_MOVED_BETWEEN_GROUPS',
        // ألبوم الأكاديمية (Academy Album)
        'CREATE_ALBUM_IMAGE', 'UPDATE_ALBUM_IMAGE', 'DELETE_ALBUM_IMAGE',
        // متجر الأكاديمية (Academy Store)
        'CREATE_PRODUCT', 'UPDATE_PRODUCT', 'DELETE_PRODUCT',
        'CREATE_STORE_ORDER', 'UPDATE_STORE_ORDER',
        // المباريات (Matches)
        'CREATE_MATCH', 'UPDATE_MATCH', 'DELETE_MATCH',
        // طلبات الانضمام الذاتي (Join Requests)
        'APPROVE_JOIN_REQUEST', 'REJECT_JOIN_REQUEST',
        // فيديوهات بروفايل اللاعب (Player Videos)
        'CREATE_PLAYER_VIDEO', 'UPDATE_PLAYER_VIDEO', 'DELETE_PLAYER_VIDEO',
      ],
    },
    entityType: {
      type: String,
      required: true,
      enum: [
        'PLAYER', 'SUBSCRIPTION', 'EVALUATION', 'ATTENDANCE', 'USER', 'ACADEMY',
        'STAFF', 'STAFF_ATTENDANCE', 'PAYROLL', 'EXPENSE',
        'PLATFORM_SUBSCRIPTION', 'PLAYER_ACCOUNT', 'GROUP', 'ALBUM',
        'PRODUCT', 'STORE_ORDER', 'MATCH', 'PLAYER_VIDEO',
      ],
    },
    entityId: {
      type: String,
      default: null,
    },
    entityName: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.userId = ret.userId?.toString();
        ret.academyId = ret.academyId?.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

activitySchema.index({ academyId: 1, createdAt: -1 });

const Activity = mongoose.model('Activity', activitySchema);
module.exports = Activity;
