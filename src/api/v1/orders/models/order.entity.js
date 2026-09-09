const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    userId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "user",
      index: true,
    },
    links: String,
    isProcessed: {
      type: Boolean,
      default: false,
    },
    dripfeed: {
      type: Number,
      required: true,
      max: 31,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

// Backs the admin "Submissions" date-range view (getOrdersByDate) and any
// other query that filters by submission date — without this, a range query
// against a 100k+ row collection falls back to a full collection scan (this
// is exactly what made getOrdersByDripfeed hang earlier).
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model("order", orderSchema);
