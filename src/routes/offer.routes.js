const express = require('express');
const { param } = require('express-validator');
const {
  listOffers,
  createOffer,
  updateOffer,
  deleteOffer,
} = require('../controllers/offer.controller');
const { protect, restrictTo } = require('../middleware/auth.middleware');
const { uploadOfferImage } = require('../config/cloudinary');
const validate = require('../middleware/validate');

const router = express.Router();

router.use(protect);

// الحساب الرئيسي (كل الفروع أو فروع مختارة) ومدير الفرع (فرعه فقط).
const manage = restrictTo('super_admin', 'academy_admin');
const idParam = [param('id').isMongoId().withMessage('معرّف العرض غير صحيح')];

router.get('/', listOffers);
router.post('/', manage, uploadOfferImage.single('image'), createOffer);
router.patch('/:id', manage, uploadOfferImage.single('image'), idParam, validate, updateOffer);
router.delete('/:id', manage, idParam, validate, deleteOffer);

module.exports = router;
