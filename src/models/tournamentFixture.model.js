const mongoose = require('mongoose');

const oid = mongoose.Schema.Types.ObjectId;

// مباراة داخل بطولة (منفصلة عن Match الخاص بالمواعيد والتذكير).
const fixtureSchema = new mongoose.Schema(
  {
    tournamentId: { type: oid, ref: 'Tournament', required: true },
    stage: { type: String, enum: ['league', 'group', 'knockout'], required: true },
    groupIndex: { type: Number, default: null },
    round: { type: Number, required: true }, // يبدأ من 1
    matchNo: { type: Number, required: true }, // ترتيب المباراة داخل الدور
    aId: { type: oid, ref: 'TournamentParticipant', default: null },
    bId: { type: oid, ref: 'TournamentParticipant', default: null },

    scoreA: { type: Number, default: null },
    scoreB: { type: Number, default: null },
    sets: { type: [{ a: Number, b: Number, _id: false }], default: [] },
    penaltiesA: { type: Number, default: null },
    penaltiesB: { type: Number, default: null },
    winnerId: { type: oid, ref: 'TournamentParticipant', default: null },
    status: { type: String, enum: ['pending', 'played', 'bye'], default: 'pending' },

    // الكأس: إلى أين يتأهل الفائز.
    nextMatchNo: { type: Number, default: null },
    nextSlot: { type: String, enum: ['a', 'b', null], default: null },

    date: { type: String, default: null },
    time: { type: String, default: null },
    location: { type: String, trim: true, default: '' },
    matchId: { type: oid, ref: 'Match', default: null }, // ربط اختياري للتذكير
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        for (const k of ['_id', 'tournamentId', 'aId', 'bId', 'winnerId', 'matchId']) {
          ret[k] = ret[k] ? ret[k].toString() : null;
        }
        delete ret.__v;
        return ret;
      },
    },
  }
);

fixtureSchema.index({ tournamentId: 1, stage: 1, round: 1, matchNo: 1 });

module.exports = mongoose.model('TournamentFixture', fixtureSchema);
