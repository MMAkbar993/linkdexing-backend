const mongoose = require("mongoose");

// One document per submitted URL. Replaces the newline-separated blob that
// used to live on Order.links — this is what makes per-URL status (Index
// Checker, later phases), pagination, and search possible.
//
// Existing orders are backfilled by scripts/migrate-links.js. New orders
// write here directly (see orders/controller.js createOrder).
const linkSchema = new mongoose.Schema(
  {
    orderId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "order",
      index: true,
    },
    userId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "user",
      index: true,
    },
    url: {
      required: true,
      type: String,
      trim: true,
    },
    // Mirrors Order.isProcessed for this specific URL. Kept per-link (rather
    // than only reading Order.isProcessed) so a future partial-processing
    // workflow doesn't require another migration.
    isProcessed: {
      type: Boolean,
      default: false,
    },
    dripfeed: {
      required: true,
      type: Number,
      max: 31,
      min: 1,
    },
    // Denormalized from the most recent IndexCheck for this link, so the
    // Links Archive table can show status without joining the index-check
    // collections. "not_checked" until the user runs a check at least once.
    indexStatus: {
      type: String,
      enum: ["not_checked", "pending", "indexed", "not_indexed"],
      default: "not_checked",
    },
    indexCheckedAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

linkSchema.index({ orderId: 1, createdAt: 1 });

module.exports = mongoose.model("link", linkSchema);
