const mongoose = require('mongoose');

// حالة تنبيه إداري لكل مستخدم (مقروء / مخفي). التنبيهات نفسها تُحسب لحظياً
// من البيانات (utils/academyAlerts.js) بمعرّفات ثابتة، وهنا تُحفظ حالتها على
// الخادم — فما يُخفى على الموبايل يختفي من الكمبيوتر أيضاً.
const alertStateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    alertId: { type: String, required: true, trim: true, maxlength: 200 },
    read: { type: Boolean, default: false },
    dismissed: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

alertStateSchema.index({ userId: 1, alertId: 1 }, { unique: true });
// التنبيهات مؤقتة بطبيعتها (أعياد ميلاد/مراحل اشتراك/غياب) — نحذف حالتها
// بعد 6 أشهر حتى لا تتضخم المجموعة.
alertStateSchema.index({ updated_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

module.exports = mongoose.model('AlertState', alertStateSchema);
