const mongoose = require('mongoose');
const StoreProduct = require('../models/storeProduct.model');
const StoreOrder = require('../models/storeOrder.model');
const Academy = require('../models/academy.model');
const AppSetting = require('../models/appSetting.model');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const { deleteImage } = require('../config/cloudinary');
const logger = require('../utils/logger');
const { logActivity } = require('../utils/activityLogger');

// ═══ متجر واحد موحّد لكل الفروع ═══
// المنتجات مشتركة (لا تخص فرعاً) ويديرها الحساب الرئيسي وحده (super_admin —
// يفرضه الراوتر). رقم واتساب الطلبات والعملة إعداد عام واحد (AppSetting
// 'store'). الطلب نفسه يبقى منسوباً لفرع اللاعب حتى يتابعه مدير فرعه.
const STORE_SETTINGS_KEY = 'store';

const parsePrice = (raw) => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

// إعدادات المتجر العامة، مع الرجوع لإعدادات الفرع القديمة إن لم تُضبط بعد
// (انتقال سلس لمن كان يستخدم رقم واتساب لكل فرع).
const storeSettingsFor = async (fallbackAcademyId) => {
  const settings = await AppSetting.get(STORE_SETTINGS_KEY);
  let whatsApp = settings.storeWhatsApp || '';
  let currency = settings.currency || '';
  if ((!whatsApp || !currency) && fallbackAcademyId) {
    const academy = await Academy.findById(fallbackAcademyId).select('phone storeWhatsApp currency');
    if (academy) {
      whatsApp = whatsApp || academy.storeWhatsApp || academy.phone || '';
      currency = currency || academy.currency || '';
    }
  }
  return { storeWhatsApp: whatsApp, currency: currency || 'EGP' };
};

// نطاق الطلبات: السوبر أدمن يرى كل الفروع (أو فرعاً عبر ?academyId=)، وغيره
// طلبات فرعه فقط.
const ordersScope = (req) => {
  if (req.user.role === 'super_admin') {
    const id = req.query.academyId;
    if (id && id !== 'all') {
      if (!mongoose.Types.ObjectId.isValid(String(id))) {
        throw new AppError('معرّف الأكاديمية غير صحيح', 400);
      }
      return { academyId: id };
    }
    return {};
  }
  return { academyId: req.user.academyId };
};

const paginate = (req, maxLimit = 60) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const pageMeta = (total, page, limit) => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
  hasNext: page * limit < total,
  hasPrev: page > 1,
});

const productsPage = async (req) => {
  const { page, limit, skip } = paginate(req);
  const [items, total] = await Promise.all([
    StoreProduct.find({}).sort({ order: 1, created_at: -1 }).skip(skip).limit(limit),
    StoreProduct.countDocuments({}),
  ]);
  return { items: items.map((i) => i.toJSON()), meta: pageMeta(total, page, limit) };
};

// ══════════════════════ المنتجات (جهة المدير) ══════════════════════

// ─── GET /store/products — منتجات المتجر الموحّد (لكل الأدوار للعرض) ───────────
const getProducts = async (req, res) => {
  const { items, meta } = await productsPage(req);
  return res.status(200).json({
    success: true,
    message: 'تم جلب منتجات المتجر بنجاح',
    data: items,
    meta,
  });
};

// ─── POST /store/products (الحساب الرئيسي فقط) ──────────────────────────────
const createProduct = async (req, res, next) => {
  if (!req.file) return next(new AppError('صورة المنتج مطلوبة', 400));

  const name = String(req.body.name || '').trim();
  if (!name) return next(new AppError('اسم المنتج مطلوب', 400));

  const price = parsePrice(req.body.price);
  if (price === null) return next(new AppError('سعر المنتج غير صحيح', 400));

  const item = await StoreProduct.create({
    academyId: null,
    name,
    description: String(req.body.description || '').trim(),
    price,
    image_url: req.file.path,
    image_public_id: req.file.filename,
    isAvailable: req.body.isAvailable === undefined
      ? true
      : String(req.body.isAvailable) === 'true',
  });

  logger.info(`Store product added: ${item._id}`);
  logActivity(req, {
    actionType: 'CREATE_PRODUCT', entityType: 'PRODUCT',
    entityId: item._id, entityName: name, academyId: req.query.academyId,
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
    entityId: item._id, entityName: item.name, academyId: req.query.academyId,
  });
  return sendSuccess(res, { data: item.toJSON(), message: 'تم تحديث المنتج بنجاح' });
};

// ─── DELETE /store/products/:id ──────────────────────────────────────────────
const deleteProduct = async (req, res, next) => {
  const item = await StoreProduct.findById(req.params.id).select('+image_public_id');
  if (!item) return next(new AppError('المنتج غير موجود', 404));

  if (item.image_public_id) {
    await deleteImage(item.image_public_id).catch(() => {});
  }
  await item.deleteOne();

  logActivity(req, {
    actionType: 'DELETE_PRODUCT', entityType: 'PRODUCT',
    entityId: item._id, entityName: item.name, academyId: req.query.academyId,
  });
  return sendSuccess(res, { message: 'تم حذف المنتج بنجاح' });
};

// ─── PATCH /store/products/reorder ───────────────────────────────────────────
const reorderProducts = async (req, res, next) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
  if (!ids || ids.length === 0) {
    return next(new AppError('قائمة المعرّفات مطلوبة', 400));
  }
  await Promise.all(
    ids.map((id, index) =>
      StoreProduct.updateOne({ _id: id }, { $set: { order: index } })
    )
  );
  return sendSuccess(res, { message: 'تم تحديث ترتيب المنتجات بنجاح' });
};

// ══════════════════════ إعدادات المتجر (رقم واتساب واحد) ══════════════════════

// ─── GET /store/settings ─────────────────────────────────────────────────────
const getStoreSettings = async (req, res) => {
  const fallback = req.user.academyId || req.query.academyId || null;
  const settings = await storeSettingsFor(
    fallback && mongoose.Types.ObjectId.isValid(String(fallback)) ? fallback : null
  );
  return sendSuccess(res, {
    data: { academyName: 'متجر كل الفروع', phone: '', ...settings },
    message: 'تم جلب إعدادات المتجر بنجاح',
  });
};

// ─── PATCH /store/settings (الحساب الرئيسي فقط) ─────────────────────────────
const updateStoreSettings = async (req, res) => {
  const patch = {};
  if (req.body.storeWhatsApp !== undefined) {
    patch.storeWhatsApp = String(req.body.storeWhatsApp).trim();
  }
  if (req.body.currency !== undefined) {
    patch.currency = String(req.body.currency).trim();
  }
  const value = await AppSetting.merge(STORE_SETTINGS_KEY, patch);
  return sendSuccess(res, {
    data: { storeWhatsApp: value.storeWhatsApp || '' },
    message: 'تم تحديث رقم واتساب المتجر بنجاح',
  });
};

// ══════════════════════ جهة اللاعب (قراءة + طلب) ══════════════════════

// ─── GET /player/store — كل منتجات المتجر الموحّد + رقم واتساب الطلبات ────────
const getPlayerStore = async (req, res) => {
  const academyId = req.player.academyId;
  const [{ items, meta }, academy, settings] = await Promise.all([
    productsPage(req),
    Academy.findById(academyId).select('name'),
    storeSettingsFor(academyId),
  ]);

  return res.status(200).json({
    success: true,
    message: 'تم جلب المتجر بنجاح',
    data: items,
    academy: {
      name: academy ? academy.name : '',
      whatsApp: settings.storeWhatsApp,
      currency: settings.currency,
    },
    meta,
  });
};

// ─── POST /player/store/orders (لاعب ينشئ طلب شراء) ──────────────────────────
// الطلب يُنسب لفرع اللاعب حتى يراه مدير فرعه.
const createPlayerOrder = async (req, res, next) => {
  const player = req.player;
  const academyId = player.academyId;

  const product = await StoreProduct.findById(req.body.productId);
  if (!product) return next(new AppError('المنتج غير موجود', 404));
  if (!product.isAvailable) {
    return next(new AppError('هذا المنتج غير متاح حالياً', 400));
  }

  const settings = await storeSettingsFor(academyId);

  const order = await StoreOrder.create({
    academyId,
    productId: product._id,
    productName: product.name,
    price: product.price,
    currency: settings.currency,
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

// ─── GET /store/orders — السوبر أدمن: كل الفروع مع اسم الفرع؛ غيره: فرعه ─────
const getOrders = async (req, res) => {
  const { page, limit, skip } = paginate(req);
  const scope = ordersScope(req);

  const filter = { ...scope };
  const validStatus = ['pending', 'contacted', 'completed', 'cancelled'];
  if (req.query.status && validStatus.includes(req.query.status)) {
    filter.status = req.query.status;
  }

  const [items, total, pendingCount] = await Promise.all([
    StoreOrder.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
    StoreOrder.countDocuments(filter),
    StoreOrder.countDocuments({ ...scope, status: 'pending' }),
  ]);

  const academyIds = [...new Set(items.map((i) => i.academyId.toString()))];
  const academies = await Academy.find({ _id: { $in: academyIds } }).select('name');
  const names = new Map(academies.map((a) => [a._id.toString(), a.name]));

  return res.status(200).json({
    success: true,
    message: 'تم جلب الطلبات بنجاح',
    data: items.map((i) => ({
      ...i.toJSON(),
      academyName: names.get(i.academyId.toString()) || '',
    })),
    meta: { ...pageMeta(total, page, limit), pendingCount },
  });
};

// ─── PATCH /store/orders/:id/status ──────────────────────────────────────────
const updateOrderStatus = async (req, res, next) => {
  const order = await StoreOrder.findById(req.params.id);
  if (!order) return next(new AppError('الطلب غير موجود', 404));
  if (
    req.user.role !== 'super_admin' &&
    order.academyId.toString() !== req.user.academyId?.toString()
  ) {
    return next(new AppError('ليس لديك صلاحية للوصول إلى هذا الطلب', 403));
  }

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
