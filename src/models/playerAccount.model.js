const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Counter = require('./counter.model');

// حساب دخول اللاعب/ولي الأمر. منفصل تماماً عن موديل User الخاص بالمدراء
// حتى لا يُمَس نظام دخول الأكاديميات القائم. اسم المستخدم عالمي على مستوى
// المنصة بصيغة nosait00001 ولا يتكرر أبداً.
const playerAccountSchema = new mongoose.Schema(
  {
    playerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Player',
      required: [true, 'معرّف اللاعب مطلوب'],
      unique: true,
    },
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Academy',
      required: [true, 'معرّف الأكاديمية مطلوب'],
    },
    username: {
      type: String,
      required: [true, 'اسم المستخدم مطلوب'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'كلمة المرور مطلوبة'],
      select: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.playerId = ret.playerId?.toString?.() ?? ret.playerId;
        ret.academyId = ret.academyId?.toString?.() ?? ret.academyId;
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

playerAccountSchema.index({ academyId: 1 });

// توليد اسم مستخدم عالمي فريد nosait00001 عبر عدّاد ذرّي.
playerAccountSchema.statics.generateUsername = async function () {
  const seq = await Counter.next('player_username');
  return 'nosait' + String(seq).padStart(5, '0');
};

// تشفير كلمة المرور عند التعديل (نفس نمط User).
playerAccountSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

playerAccountSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const PlayerAccount = mongoose.model('PlayerAccount', playerAccountSchema);
module.exports = PlayerAccount;
