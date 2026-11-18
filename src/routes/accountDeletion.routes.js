const express = require('express');
const { body, param } = require('express-validator');
const rateLimit = require('express-rate-limit');
const {
  showDeletionPage,
  submitDeletionRequest,
  listDeletionRequests,
  updateDeletionRequest,
} = require('../controllers/accountDeletion.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

// حد صارم لمنع إغراق نموذج الحذف العام: 5 طلبات / ساعة / IP.
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).type('html').send(
      '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>محاولات كثيرة</title>' +
      '<p style="font-family:sans-serif;padding:24px">تم تجاوز عدد المحاولات المسموح به. حاول مرة أخرى بعد ساعة، ' +
      'أو راسلنا على ahmed@nosait.com.</p></html>'
    );
  },
});

// صفحة عامة: /delete-account
const publicRouter = express.Router();
publicRouter.get('/', showDeletionPage);
publicRouter.post('/', submitLimiter, submitDeletionRequest);

// API للسوبر أدمن: /api/v1/account-deletion-requests
const adminRouter = express.Router();
adminRouter.use(protect, restrictTo('super_admin'));
adminRouter.get('/', listDeletionRequests);
adminRouter.patch(
  '/:id',
  [
    param('id').isMongoId().withMessage('معرّف غير صحيح'),
    body('status').isIn(['pending', 'completed', 'rejected']).withMessage('حالة غير صحيحة'),
    body('adminNote').optional().isString().isLength({ max: 1000 }),
  ],
  validate,
  updateDeletionRequest
);

module.exports = { publicRouter, adminRouter };
