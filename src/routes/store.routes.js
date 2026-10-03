const express = require('express');
const { body, param } = require('express-validator');
const {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  reorderProducts,
  getStoreSettings,
  updateStoreSettings,
  getOrders,
  updateOrderStatus,
} = require('../controllers/store.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { uploadStoreImage } = require('../config/cloudinary');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

const manage = restrictTo('super_admin', 'academy_admin', 'admin');
// المتجر موحّد لكل الفروع: المنتجات والإعدادات يديرها الحساب الرئيسي وحده.
const ownerOnly = restrictTo('super_admin');

// ── إعدادات المتجر (رقم واتساب) ──
router.get('/settings', getStoreSettings);
router.patch(
  '/settings',
  ownerOnly,
  [
    body('storeWhatsApp').optional().isLength({ max: 20 })
      .withMessage('رقم واتساب المتجر لا يمكن أن يتجاوز 20 حرف'),
  ],
  validate,
  updateStoreSettings
);

// ── الطلبات (جهة المدير) ──
router.get('/orders', getOrders);
router.patch(
  '/orders/:id/status',
  manage,
  [
    param('id').isMongoId().withMessage('معرّف الطلب غير صحيح'),
    body('status').isIn(['pending', 'contacted', 'completed', 'cancelled'])
      .withMessage('حالة الطلب غير صحيحة'),
  ],
  validate,
  updateOrderStatus
);

// ── المنتجات ──
// GET /store/products — قائمة مرقّمة (Pagination)
router.get('/products', getProducts);

// PATCH /store/products/reorder ← قبل /:id لتفادي التعارض
router.patch('/products/reorder', ownerOnly, reorderProducts);

// POST /store/products — رفع منتج (صورة + اسم + سعر + وصف)
router.post(
  '/products',
  ownerOnly,
  uploadStoreImage.single('image'),
  [
    body('name').notEmpty().withMessage('اسم المنتج مطلوب')
      .isLength({ max: 150 }).withMessage('اسم المنتج لا يمكن أن يتجاوز 150 حرف'),
    body('price').notEmpty().withMessage('سعر المنتج مطلوب')
      .isFloat({ min: 0 }).withMessage('سعر المنتج غير صحيح'),
    body('description').optional().isLength({ max: 1000 })
      .withMessage('الوصف لا يمكن أن يتجاوز 1000 حرف'),
  ],
  validate,
  createProduct
);

// PATCH /store/products/:id — تعديل الاسم/الوصف/السعر/التوفّر
router.patch(
  '/products/:id',
  ownerOnly,
  [
    param('id').isMongoId().withMessage('معرّف المنتج غير صحيح'),
    body('name').optional().isLength({ min: 1, max: 150 })
      .withMessage('اسم المنتج يجب أن يكون بين 1 و 150 حرف'),
    body('price').optional().isFloat({ min: 0 })
      .withMessage('سعر المنتج غير صحيح'),
    body('description').optional().isLength({ max: 1000 })
      .withMessage('الوصف لا يمكن أن يتجاوز 1000 حرف'),
  ],
  validate,
  updateProduct
);

// DELETE /store/products/:id
router.delete(
  '/products/:id',
  ownerOnly,
  [param('id').isMongoId().withMessage('معرّف المنتج غير صحيح')],
  validate,
  deleteProduct
);

module.exports = router;
