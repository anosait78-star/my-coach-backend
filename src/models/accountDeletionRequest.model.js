const mongoose = require('mongoose');

// طلب حذف حساب وبياناته — مطلوب من سياسة Google Play (رابط ويب عام لطلب الحذف).
// يُرسَل من صفحة /delete-account بلا تسجيل دخول، ويعالجه السوبر أدمن يدوياً.
const accountDeletionRequestSchema = new mongoose.Schema(
  {
    // اسم المستخدم أو البريد أو رقم الهاتف المسجَّل به الحساب.
    accountIdentifier: { type: String, required: true, trim: true, maxlength: 150 },
    academyName: { type: String, default: '', trim: true, maxlength: 150 },
    requesterName: { type: String, default: '', trim: true, maxlength: 100 },
    // وسيلة تواصل لتأكيد الطلب (بريد أو هاتف).
    contact: { type: String, required: true, trim: true, maxlength: 150 },
    relationship: { type: String, enum: ['self', 'parent', 'other'], default: 'self' },
    reason: { type: String, default: '', trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['pending', 'completed', 'rejected'],
      default: 'pending',
      index: true,
    },
    adminNote: { type: String, default: '', trim: true, maxlength: 1000 },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    toJSON: {
      transform(doc, ret) {
        ret._id = ret._id.toString();
        delete ret.__v;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model('AccountDeletionRequest', accountDeletionRequestSchema);
