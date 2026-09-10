export const notFound = (req, res) => {
  res.status(404).json({ code: "NOT_FOUND", message: `Route not found: ${req.originalUrl}` });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  console.error(err);

  let statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  let code = err.code && typeof err.code === "string" ? err.code : "INTERNAL_ERROR";

  if (err?.name === "ValidationError") {
    statusCode = 400;
    code = "VALIDATION_ERROR";
  } else if (err?.name === "CastError") {
    statusCode = 400;
    code = "INVALID_ID";
  } else if (err?.code === 11000) {
    statusCode = 409;
    code = "DUPLICATE_RESOURCE";
  } else if (err?.name === "MulterError") {
    statusCode = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    code = err.code === "LIMIT_FILE_SIZE" ? "FILE_TOO_LARGE" : "UPLOAD_ERROR";
  }

  res.status(statusCode).json({
    code,
    message: err.message || "Something went wrong on our end. Please try again.",
    requestId: req.requestId,
    ...(process.env.NODE_ENV === "production" ? {} : { stack: err.stack }),
  });
};
