const sendSuccess = (res, { data = null, message = 'تمت العملية بنجاح', statusCode = 200, meta = null } = {}) => {
  const response = { success: true, message, data };
  if (meta) response.meta = meta;
  return res.status(statusCode).json(response);
};

const sendError = (res, { message = 'حدث خطأ', statusCode = 500 } = {}) => {
  return res.status(statusCode).json({ success: false, message });
};

const sendPaginated = (res, { data, total, page, limit, message = 'تمت العملية بنجاح' } = {}) => {
  return res.status(200).json({
    success: true,
    message,
    data,
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

module.exports = { sendSuccess, sendError, sendPaginated };
