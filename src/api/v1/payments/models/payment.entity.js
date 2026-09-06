const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "user",
      index: true,
    },
    // Snapshot at time of purchase — convenient for the admin Payment Logs
    // table without a populate, and stays correct even if the account's
    // email later changes.
    userEmail: {
      type: String,
      trim: true,
    },
    // Set as soon as the PayPal order is created (before the buyer has
    // approved anything). Unique — one Payment document per checkout
    // attempt.
    paypalOrderId: {
      required: true,
      type: String,
      unique: true,
    },
    // Set only once the order is captured. Unique + sparse: a second capture
    // attempt on the same order (a retry, a double-click) hits this index
    // rather than crediting twice.
    paypalCaptureId: {
      type: String,
      unique: true,
      sparse: true,
    },
    amount: {
      required: true,
      type: Number,
    },
    currency: {
      type: String,
      default: "USD",
    },
    credits: {
      required: true,
      type: Number,
    },
    bonusCredits: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
      index: true,
    },
    paymentMethod: {
      type: String,
      default: "paypal",
    },
    // The raw capture response from PayPal, kept for support/debugging.
    rawCapture: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("payment", paymentSchema);
