const mongoose = require('mongoose');

// عدّاد ذرّي عام على مستوى المنصة. يُستخدم لتوليد أرقام تسلسلية فريدة
// لا تتكرر أبداً (مثل أرقام دخول اللاعبين nosait00001). يعتمد على
// findOneAndUpdate($inc) وهي عملية ذرّية تمنع التصادم عند التزامن.
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // اسم العدّاد، مثل 'player_username'
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
);

// يزيد العدّاد بمقدار واحد ذرّياً ويعيد القيمة الجديدة.
counterSchema.statics.next = async function (name) {
  const doc = await this.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc.seq;
};

const Counter = mongoose.model('Counter', counterSchema);
module.exports = Counter;
