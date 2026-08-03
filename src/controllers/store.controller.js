const StoreProduct = require('../models/storeProduct.model');
const StoreOrder = require('../models/storeOrder.model');
const Academy = require('../models/academy.model');
const AppError = require('../utils/AppError');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');

// نفس نمط الألبوم/المجموعات: super_admin وحده يمرّر academyId صراحةً،
// وكل من عداه مُقيَّد حتمياً بأكاديميته.
const resolveAcademyFilter = (req) => {
  if (req.user.role === 'super_admin') {
    if (!req.query.academyId) {
      throw new AppError('معرّف الأكاديمية مطلوب', 400);
    }
    return req.query.academyId;
  }
  return req.user.academyId;
};

// حارس وصول لعنصر يخصّ أكاديمية أخرى. super_admin وحده يتجاوز القيد.
const assertAccess = (req, item) => {
  if (
    req.user.role !== 'super_admin' &&
    item.academyId.toString() !== req.user.academyId?.toString()
  ) {
    throw new AppError('ليس لديك صلاحية للوصول إلى هذا العنصر', 403);
  }
};

const parsePrice = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

// ══════════════════════ المنتجات (جهة المدير) ══════════════════════

// صفحة موحّدة لجلب منتجات أكاديمية معيّنة (Pagination + Lazy Loading).
const paginateProducts = async (academyId, req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    StoreProduct.find({ academyId })
      .sort({ order: 1, created_at: -1 })
      .skip(skip)
      .limit(limit),
    StoreProduct.countDocuments({ academyId }),
  ]);

  return sendPaginated(res, {
    data: items.map((i) => i.toJSON()),
    total,
    page,
    limit,
    message: 'تم جلب منتجات المتجر بنجاح',
  });
};

// ─── GET /store/products (جهة المدير) ────────────────────────────────────────
const getProducts = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  return paginateProducts(academyId, req, res);
};

// ─── POST /store/products ────────────────────────────────────────────────────
const createProduct = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  if (!req.file) return next(new AppError('صورة المنتج مطلوبة', 400));

  const name = String(req.body.name || '').trim();
  if (!name) return next(new AppError('اسم المنتج مطلوب', 400));

  const price = parsePrice(req.body.price);
  if (price === null) return next(new AppError('سعر المنتج غير صحيح', 400));

  const item = await StoreProduct.create({
    academyId,
    name,
    description: String(req.body.description || '').trim(),
    price,
    image_url: req.file.path,
    image_public_id: req.file.filename,
    isAvailable: req.body.isAvailable === undefined
      ? true
      : String(req.body.isAvailable) === 'true',
  });

  logger.info(`Store product added: ${item._id} (academy ${academyId})`);
  logActivity(req, {
    actionType: 'CREATE_PRODUCT', entityType: 'PRODUCT',
    entityId: item._id, entityName: name, academyId,
  });
  return sendSuccess(res, {
    data: item.toJSON(),
    message: 'تمت إضافة المنتج بنجاح',
    statusCode: 201,
  });
};

// ─── PATCH /store/products/:id (تعديل الاسم/الوصف/السعر/التوفّر) ──────────────
const updateProduct = async (req, res, next) => {
  const item = await StoreProduct.findById(req.params.id);
  if (!item) return next(new AppError('المنتج غير موجود', 404));
  assertAccess(req, item);

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return next(new AppError('اسم المنتج مطلوب', 400));
    item.name = name;
  }
  if (req.body.description !== undefined) {
    item.description = String(req.body.description).trim();
  }
  if (req.body.price !== undefined) {
    const price = parsePrice(req.body.price);
    if (price === null) return next(new AppError('سعر المنتج غير صحيح', 400));
    item.price = price;
  }
  if (req.body.isAvailable !== undefined) {
    item.isAvailable =
      req.body.isAvailable === true || String(req.body.isAvailable) === 'true';
  }
  await item.save();

  logActivity(req, {
    actionType: 'UPDATE_PRODUCT', entityType: 'PRODUCT',
    entityId: item._id, entityName: item.name, academyId: item.academyId,
  });
  return sendSuccess(res, { data: item.toJSON(), message: 'تم تحديث المنتج بنجاح' });
};

// ─── DELETE /store/products/:id ──────────────────────────────────────────────
const deleteProduct = async (req, res, next) => {
  const item = await StoreProduct.findById(req.params.id).select('+image_public_id');
  if (!item) return next(new AppError('المنتج غير موجود', 404));
  assertAccess(req, item);

  if (item.image_public_id) {
    await deleteImage(item.image_public_id).catch(() => {});
  }
  await item.deleteOne();

  logActivity(req, {
    actionType: 'DELETE_PRODUCT', entityType: 'PRODUCT',
    entityId: item._id, entityName: item.name, academyId: item.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف المنتج بنجاح' });
};

// ─── PATCH /store/products/reorder ───────────────────────────────────────────
const reorderProducts = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
  if (!ids || ids.length === 0) {
    return next(new AppError('قائمة المعرّفات مطلوبة', 400));
  }
  await Promise.all(
    ids.map((id, index) =>
      StoreProduct.updateOne({ _id: id, academyId }, { $set: { order: index } })
    )
  );
  return sendSuccess(res, { message: 'تم تحديث ترتيب المنتجات بنجاح' });
};

// ══════════════════════ إعدادات المتجر (رقم واتساب) ══════════════════════

// ─── GET /store/settings ─────────────────────────────────────────────────────
const getStoreSettings = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  const academy = await Academy.findById(academyId).select('name phone storeWhatsApp currency');
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));
  return sendSuccess(res, {
    data: {
      academyName: academy.name,
      phone: academy.phone,
      storeWhatsApp: academy.storeWhatsApp || '',
      currency: academy.currency || 'EGP',
    },
    message: 'تم جلب إعدادات المتجر بنجاح',
  });
};

// ─── PATCH /store/settings (تحديث رقم واتساب المتجر) ─────────────────────────
const updateStoreSettings = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  const academy = await Academy.findById(academyId);
  if (!academy) return next(new AppError('الأكاديمية غير موجودة', 404));

  if (req.body.storeWhatsApp !== undefined) {
    academy.storeWhatsApp = String(req.body.storeWhatsApp).trim();
  }
  await academy.save();

  return sendSuccess(res, {
    data: { storeWhatsApp: academy.storeWhatsApp || '' },
    message: 'تم تحديث رقم واتساب المتجر بنجاح',
  });
};

// ══════════════════════ جهة اللاعب (قراءة + طلب) ══════════════════════

// ─── GET /player/store (قراءة فقط — أكاديمية اللاعب حصراً) ───────────────────
// يعيد المنتجات (مرقّمة) + سياق الأكاديمية (اسمها ورقم واتساب المتجر وعملتها)
// حتى يبني الفرونت زر الشراء عبر واتساب دون طلب إضافي.
const getPlayerStore = async (req, res, next) => {
  const academyId = req.player.academyId; // عزل صارم: أكاديمية اللاعب فقط.
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [items, total, academy] = await Promise.all([
    StoreProduct.find({ academyId })
      .sort({ order: 1, created_at: -1 })
      .skip(skip)
      .limit(limit),
    StoreProduct.countDocuments({ academyId }),
    Academy.findById(academyId).select('name phone storeWhatsApp currency'),
  ]);

  const whatsApp = (academy && (academy.storeWhatsApp || academy.phone)) || '';

  return res.status(200).json({
    success: true,
    message: 'تم جلب المتجر بنجاح',
    data: items.map((i) => i.toJSON()),
    academy: {
      name: academy ? academy.name : '',
      whatsApp,
      currency: (academy && academy.currency) || 'EGP',
    },
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  });
};

// ─── POST /player/store/orders (لاعب ينشئ طلب شراء) ──────────────────────────
const createPlayerOrder = async (req, res, next) => {
  const player = req.player;
  const academyId = player.academyId;
  const productId = req.body.productId;

  const product = await StoreProduct.findOne({ _id: productId, academyId });
  if (!product) return next(new AppError('المنتج غير موجود', 404));
  if (!product.isAvailable) {
    return next(new AppError('هذا المنتج غير متاح حالياً', 400));
  }

  const academy = await Academy.findById(academyId).select('currency');

  const order = await StoreOrder.create({
    academyId,
    productId: product._id,
    productName: product.name,
    price: product.price,
    currency: (academy && academy.currency) || 'EGP',
    playerId: player._id,
    playerName: player.fullName,
    status: 'pending',
  });

  logger.info(`Store order created: ${order._id} (academy ${academyId}, player ${player._id})`);
  return sendSuccess(res, {
    data: order.toJSON(),
    message: 'تم تسجيل طلبك بنجاح',
    statusCode: 201,
  });
};

// ══════════════════════ الطلبات (جهة المدير) ══════════════════════

// ─── GET /store/orders (قائمة طلبات الأكاديمية، فلترة اختيارية بالحالة) ──────
const getOrders = async (req, res, next) => {
  const academyId = resolveAcademyFilter(req);
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(60, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter = { academyId };
  const validStatus = ['pending', 'contacted', 'completed', 'cancelled'];
  if (req.query.status && validStatus.includes(req.query.status)) {
    filter.status = req.query.status;
  }

  const [items, total, pendingCount] = await Promise.all([
    StoreOrder.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
    StoreOrder.countDocuments(filter),
    StoreOrder.countDocuments({ academyId, status: 'pending' }),
  ]);

  return res.status(200).json({
    success: true,
    message: 'تم جلب الطلبات بنجاح',
    data: items.map((i) => i.toJSON()),
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
      pendingCount,
    },
  });
};

// ─── PATCH /store/orders/:id/status ──────────────────────────────────────────
const updateOrderStatus = async (req, res, next) => {
  const order = await StoreOrder.findById(req.params.id);
  if (!order) return next(new AppError('الطلب غير موجود', 404));
  assertAccess(req, order);

  const validStatus = ['pending', 'contacted', 'completed', 'cancelled'];
  const status = String(req.body.status || '');
  if (!validStatus.includes(status)) {
    return next(new AppError('حالة الطلب غير صحيحة', 400));
  }
  order.status = status;
  await order.save();

  logActivity(req, {
    actionType: 'UPDATE_STORE_ORDER', entityType: 'STORE_ORDER',
    entityId: order._id, entityName: order.productName, academyId: order.academyId,
  });
  return sendSuccess(res, { data: order.toJSON(), message: 'تم تحديث حالة الطلب بنجاح' });
};

module.exports = {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  reorderProducts,
  getStoreSettings,
  updateStoreSettings,
  getPlayerStore,
  createPlayerOrder,
  getOrders,
  updateOrderStatus,
};
