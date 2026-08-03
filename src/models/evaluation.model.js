const mongoose = require('mongoose');

const evaluationSchema = new mongoose.Schema(
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
    evaluatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'معرّف المقيِّم مطلوب'],
    },
    evaluationDate: {
      type: Date,
      required: [true, 'تاريخ التقييم مطلوب'],
      default: Date.now,
    },
    fitness: {
      type: Number,
      required: [true, 'تقييم اللياقة مطلوب'],
      min: [1, 'الحد الأدنى للتقييم هو 1'],
      max: [10, 'الحد الأقصى للتقييم هو 10'],
    },
    basicSkills: {
      type: Number,
      required: [true, 'تقييم المهارات الأساسية مطلوب'],
      min: [1, 'الحد الأدنى للتقييم هو 1'],
      max: [10, 'الحد الأقصى للتقييم هو 10'],
    },
    attack: {
      type: Number,
      required: [true, 'تقييم الهجوم مطلوب'],
      min: [1, 'الحد الأدنى للتقييم هو 1'],
      max: [10, 'الحد الأقصى للتقييم هو 10'],
    },
    defense: {
      type: Number,
      required: [true, 'تقييم الدفاع مطلوب'],
      min: [1, 'الحد الأدنى للتقييم هو 1'],
      max: [10, 'الحد الأقصى للتقييم هو 10'],
    },
    commitment: {
      type: Number,
      required: [true, 'تقييم الالتزام مطلوب'],
      min: [1, 'الحد الأدنى للتقييم هو 1'],
      max: [10, 'الحد الأقصى للتقييم هو 10'],
    },
    average: {
      type: Number,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'الملاحظات لا يمكن أن تتجاوز 500 حرف'],
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        ret._id = ret._id.toString();
        ret.academyId = ret.academyId?.toString();
        ret.playerId = ret.playerId?.toString();
        ret.evaluatorId = ret.evaluatorId?.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Auto-calculate average before save
evaluationSchema.pre('save', function (next) {
  this.average = parseFloat(
    ((this.fitness + this.basicSkills + this.attack + this.defense + this.commitment) / 5).toFixed(2)
  );
  next();
});

// Indexes
evaluationSchema.index({ playerId: 1 });
evaluationSchema.index({ academyId: 1 });
evaluationSchema.index({ playerId: 1, evaluationDate: -1 });
evaluationSchema.index({ academyId: 1, playerId: 1 });

const Evaluation = mongoose.model('Evaluation', evaluationSchema);
module.exports = Evaluation;
