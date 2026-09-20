const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema(
  {
    code: {
      required: true,
      type: String,
      unique: true,
      uppercase: true,
      trim: true,
    },
    discountType: {
      required: true,
      type: String,
      enum: ["percent", "flat"],
    },
    // percent: 1-100. flat: a USD amount, capped to the package price at
    // apply time so a coupon can never make a package cost less than the
    // minimum PayPal charge (see services/coupons.js).
    discountValue: {
      required: true,
      type: Number,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    // null/unset = never expires.
    expiresAt: {
      type: Date,
    },
    // null/unset = unlimited total redemptions.
    maxRedemptions: {
      type: Number,
      min: 1,
    },
    // Only incremented once a payment actually completes (see
    // payments/controller.js's completePayment) - an abandoned checkout
    // never burns a redemption.
    redemptionCount: {
      type: Number,
      default: 0,
    },
    // How many times a single user may redeem this code. 0 = unlimited.
    perUserLimit: {
      type: Number,
      default: 1,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("coupon", couponSchema);
