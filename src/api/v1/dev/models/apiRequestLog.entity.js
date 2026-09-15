const mongoose = require("mongoose");

// One row per developer-API request. Backs both the admin's view into API
// usage and the "Usage" numbers shown on the user's own Developer API page
// (requests, credits used, remaining balance).
const apiRequestLogSchema = new mongoose.Schema(
  {
    apiKeyId: {
      type: mongoose.Types.ObjectId,
      ref: "apiKey",
      index: true,
    },
    userId: {
      type: mongoose.Types.ObjectId,
      ref: "user",
      index: true,
    },
    ip: { type: String },
    method: { type: String },
    endpoint: { type: String },
    statusCode: { type: Number },
    executionTimeMs: { type: Number },
    creditsCharged: { type: Number, default: 0 },
  },
  { timestamps: true }
);

apiRequestLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("apiRequestLog", apiRequestLogSchema);
