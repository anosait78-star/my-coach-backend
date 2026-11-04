const mongoose = require('mongoose');

// مشارك في بطولة: لاعب واحد (فردي) أو فريق يختار الأدمن لاعبيه (جماعي).
const participantSchema = new mongoose.Schema(
  {
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
    name: {
      type: String,
      required: [true, 'اسم المشارك مطلوب'],
      trim: true,
      maxlength: [100, 'الاسم لا يمكن أن يتجاوز 100 حرف'],
    },
    // فردي: لاعب واحد بالضبط — جماعي: لاعب أو أكثر.
    playerIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
      validate: { validator: (a) => Array.isArray(a) && a.length > 0, message: 'يجب اختيار لاعب واحد على الأقل' },
    },
    captainId: { type: mongoose.Schema.Types.ObjectId, ref: 'Player', default: null },
    seed: { type: Number, default: null }, // للقرعة الموجّهة (1 = الأقوى)
    groupIndex: { type: Number, default: null }, // رقم المجموعة في نظام المجموعات
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        ret._id = ret._id.toString();
        ret.tournamentId = ret.tournamentId?.toString();
        ret.playerIds = (ret.playerIds || []).map((id) => id.toString());
        ret.captainId = ret.captainId ? ret.captainId.toString() : null;
        delete ret.__v;
        return ret;
      },
    },
  }
);

participantSchema.index({ tournamentId: 1 });
participantSchema.index({ playerIds: 1 });

module.exports = mongoose.model('TournamentParticipant', participantSchema);
