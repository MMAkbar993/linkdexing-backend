const Coupon = require("../api/v1/coupons/models/coupon.entity");
const CouponRedemption = require("../api/v1/coupons/models/couponRedemption.entity");

class CouponError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "CouponError";
    this.statusCode = statusCode;
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// PayPal won't process a near-zero charge - a coupon can discount a package
// close to free, but never below this.
const MIN_CHARGE_USD = 0.5;

// Looks up a coupon by code and checks it's usable right now, for this user
// and this package price. Never trusts a discount amount from the client -
// the discount is always recomputed here from the coupon record.
async function validateCoupon(rawCode, { userId, price, session } = {}) {
  const code = String(rawCode || "")
    .trim()
    .toUpperCase();
  if (!code) {
    throw new CouponError("Enter a coupon code");
  }

  const coupon = await Coupon.findOne({ code }).session(session || null);
  if (!coupon || !coupon.isActive) {
    throw new CouponError("Invalid coupon code");
  }
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    throw new CouponError("This coupon has expired");
  }
  if (coupon.maxRedemptions && coupon.redemptionCount >= coupon.maxRedemptions) {
    throw new CouponError("This coupon has reached its usage limit");
  }

  if (coupon.perUserLimit > 0 && userId) {
    const usedByUser = await CouponRedemption.countDocuments({
      couponId: coupon._id,
      userId,
    }).session(session || null);
    if (usedByUser >= coupon.perUserLimit) {
      throw new CouponError("You've already used this coupon");
    }
  }

  const rawDiscount =
    coupon.discountType === "percent"
      ? (price * coupon.discountValue) / 100
      : coupon.discountValue;

  const finalPrice = Math.max(round2(price - rawDiscount), MIN_CHARGE_USD);
  const discountAmount = round2(price - finalPrice);

  return { coupon, discountAmount, finalPrice };
}

// Records a coupon as used - called once a payment actually completes, not
// at checkout start, so an abandoned cart never burns a limited-use code.
// Must run inside the same transaction as the payment completion it belongs to.
async function redeemCoupon(coupon, { userId, paymentId, discountAmount, session }) {
  await Coupon.updateOne(
    { _id: coupon._id },
    { $inc: { redemptionCount: 1 } },
    { session }
  );
  await CouponRedemption.create(
    [{ couponId: coupon._id, userId, paymentId, discountAmount }],
    { session }
  );
}

module.exports = { validateCoupon, redeemCoupon, CouponError, MIN_CHARGE_USD };
