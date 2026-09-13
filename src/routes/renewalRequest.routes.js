const express = require('express');
const { body, param } = require('express-validator');
const {
  listRenewalRequests,
  getPendingCount,
  reviewRenewalRequest,
} = require('../controllers/renewalRequest.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate');

const router = express.Router();

// طلبات التجديد تُراجَع من السوبر أدمن فقط.
router.use(protect, restrictTo('super_admin'));

router.get('/', listRenewalRequests);
router.get('/pending-count', getPendingCount);
router.patch(
  '/:id',
  [
    param('id').isMongoId().withMessage('معرّف الطلب غير صحيح'),
    body('status').isIn(['approved', 'rejected']).withMessage('الحالة غير صحيحة'),
    body('rejectionReason').optional()
      .isLength({ max: 500 }).withMessage('سبب الرفض لا يمكن أن يتجاوز 500 حرف'),
  ],
  validate,
  reviewRenewalRequest
);

module.exports = router;
