const mongoose = require("mongoose");

// One row per completed purchase that used a coupon - the source of truth
// for enforcing a coupon's perUserLimit, and an audit trail of exactly who
// used which code and how much it saved them.
const couponRedemptionSchema = new mongoose.Schema(
  {
    couponId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "coupon",
      index: true,
    },
    userId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "user",
      index: true,
    },
    paymentId: {
      type: mongoose.Types.ObjectId,
      ref: "payment",
    },
    discountAmount: {
      required: true,
      type: Number,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("couponRedemption", couponRedemptionSchema);
