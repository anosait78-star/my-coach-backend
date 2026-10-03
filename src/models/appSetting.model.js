const mongoose = require('mongoose');

// إعدادات عامة على مستوى المنصة كلها (لا تخص فرعاً بعينه) — وثيقة واحدة لكل
// مفتاح. أول استخدام: 'store' = إعدادات المتجر الموحّد لكل الفروع
// ({ storeWhatsApp, currency }).
const appSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

appSettingSchema.statics.get = async function (key) {
  const doc = await this.findOne({ key });
  return (doc && doc.value) || {};
};

appSettingSchema.statics.merge = async function (key, patch) {
  const current = await this.get(key);
  const value = { ...current, ...patch };
  await this.updateOne({ key }, { $set: { value } }, { upsert: true });
  return value;
};

module.exports = mongoose.model('AppSetting', appSettingSchema);
