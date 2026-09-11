const mongoose = require("mongoose");

// A single settings document, admin-editable, read by every part of the
// backend that needs a tunable value instead of a hardcoded constant.
// Starts with just the index-check price; add fields here as more
// admin-configurable settings come up.
const appSettingsSchema = new mongoose.Schema(
  {
    // Always "global" - one document, string id so src/services/settings.js
    // can upsert it by a known key instead of a generated ObjectId.
    _id: { type: String },
    // Credits charged per URL for an index check (Feature 2). 0.1 = 10
    // checks per credit, matching the client's original spec.
    costPerIndexCheck: {
      type: Number,
      default: 0.1,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("appSettings", appSettingsSchema);
