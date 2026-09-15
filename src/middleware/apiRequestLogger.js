// Logs every developer-API request (src/api/v1/dev/routes.js): IP,
// endpoint, execution time, status, and any credits the request charged.
// Mounted after apiKeyAuth.authenticate, so req.apiKey/req.apiUser are set.
// A handler that debits credits sets res.locals.creditsCharged before
// responding; this only reads it, it doesn't charge anything itself.
const ApiRequestLog = require("../api/v1/dev/models/apiRequestLog.entity");

module.exports = function apiRequestLogger(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    ApiRequestLog.create({
      apiKeyId: req.apiKey?._id,
      userId: req.apiUser?._id,
      ip: req.ip,
      method: req.method,
      endpoint: req.originalUrl,
      statusCode: res.statusCode,
      executionTimeMs: Date.now() - start,
      creditsCharged: res.locals.creditsCharged || 0,
    }).catch((err) => {
      console.error("Failed to write API request log:", err.message);
    });
  });

  next();
};
