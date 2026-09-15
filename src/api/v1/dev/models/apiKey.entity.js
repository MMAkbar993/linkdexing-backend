const mongoose = require("mongoose");

// One active key per user, generated from their own account (the "Developer
// API" page). The real key is shown in full exactly once, at creation or
// regeneration - only its SHA-256 hash is ever stored, so a database leak
// can't hand out working keys. keyPrefix is just enough of the real key to
// let a user recognize it in the UI ("lkdx_live_a1b2c3d4…") without being
// able to reconstruct the whole thing from it.
const apiKeySchema = new mongoose.Schema(
  {
    userId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "user",
      index: true,
    },
    keyHash: {
      required: true,
      type: String,
      unique: true,
    },
    keyPrefix: {
      required: true,
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastUsedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("apiKey", apiKeySchema);
