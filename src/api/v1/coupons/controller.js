const Coupon = require("./models/coupon.entity");
const { findPackage } = require("../../../config/creditPackages");
const couponsService = require("../../../services/coupons");
const { logAction } = require("../../../services/audit");

const DISCOUNT_TYPES = ["percent", "flat"];

// ---------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------

exports.listCoupons = async (req, res, next) => {
  try {
    const list = await Coupon.find({}).sort({ createdAt: -1 });
    return res.json({ ok: true, coupons: list });
  } catch (err) {
    return next(err);
  }
};

exports.createCoupon = async (req, res, next) => {
  try {
    const { code, discountType, discountValue, expiresAt, maxRedemptions, perUserLimit } =
      req.body;

    if (!code || typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ ok: false, message: "A coupon code is required" });
    }
    if (!DISCOUNT_TYPES.includes(discountType)) {
      return res
        .status(400)
        .json({ ok: false, message: "discountType must be 'percent' or 'flat'" });
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      return res
        .status(400)
        .json({ ok: false, message: "discountValue must be a positive number" });
    }
    if (discountType === "percent" && discountValue > 100) {
      return res.status(400).json({ ok: false, message: "A percent discount can't exceed 100" });
    }
    if (maxRedemptions !== undefined && maxRedemptions !== null && maxRedemptions !== "") {
      if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1) {
        return res
          .status(400)
          .json({ ok: false, message: "maxRedemptions must be a positive whole number" });
      }
    }
    if (perUserLimit !== undefined && perUserLimit !== null && perUserLimit !== "") {
      if (!Number.isInteger(perUserLimit) || perUserLimit < 0) {
        return res
          .status(400)
          .json({ ok: false, message: "perUserLimit must be a whole number (0 = unlimited)" });
      }
    }

    const doc = await Coupon.create({
      code: code.trim().toUpperCase(),
      discountType,
      discountValue,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      maxRedemptions: maxRedemptions || undefined,
      perUserLimit: perUserLimit === undefined || perUserLimit === "" ? 1 : perUserLimit,
    });

    await logAction({
      actorType: "admin",
      actorId: req.admin?.id,
      action: "coupon.created",
      targetType: "coupon",
      targetId: doc._id,
      meta: { code: doc.code, discountType: doc.discountType, discountValue: doc.discountValue },
    });

    return res.status(201).json({ ok: true, coupon: doc });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ ok: false, message: "A coupon with that code already exists" });
    }
    return next(err);
  }
};

exports.updateCoupon = async (req, res, next) => {
  try {
    const patch = {};
    const { isActive, discountType, discountValue, expiresAt, maxRedemptions, perUserLimit } =
      req.body;

    if (isActive !== undefined) patch.isActive = Boolean(isActive);

    if (discountType !== undefined) {
      if (!DISCOUNT_TYPES.includes(discountType)) {
        return res
          .status(400)
          .json({ ok: false, message: "discountType must be 'percent' or 'flat'" });
      }
      patch.discountType = discountType;
    }

    if (discountValue !== undefined) {
      if (!Number.isFinite(discountValue) || discountValue <= 0) {
        return res
          .status(400)
          .json({ ok: false, message: "discountValue must be a positive number" });
      }
      patch.discountValue = discountValue;
    }

    if (expiresAt !== undefined) {
      patch.expiresAt = expiresAt ? new Date(expiresAt) : null;
    }
    if (maxRedemptions !== undefined) {
      patch.maxRedemptions = maxRedemptions || null;
    }
    if (perUserLimit !== undefined) {
      patch.perUserLimit = perUserLimit;
    }

    const doc = await Coupon.findByIdAndUpdate(req.params.id, patch, {
      new: true,
      runValidators: true,
    });
    if (!doc) {
      return res.status(404).json({ ok: false, message: "Coupon not found" });
    }

    await logAction({
      actorType: "admin",
      actorId: req.admin?.id,
      action: "coupon.updated",
      targetType: "coupon",
      targetId: doc._id,
      meta: patch,
    });

    return res.json({ ok: true, coupon: doc });
  } catch (err) {
    return next(err);
  }
};

// Deleting is only allowed before a coupon has ever been used, so
// CouponRedemption rows never end up pointing at a coupon that no longer
// exists. A used coupon can still be turned off via updateCoupon/isActive.
exports.deleteCoupon = async (req, res, next) => {
  try {
    const doc = await Coupon.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ ok: false, message: "Coupon not found" });
    }
    if (doc.redemptionCount > 0) {
      return res.status(400).json({
        ok: false,
        message: "This coupon has already been used and can't be deleted — deactivate it instead.",
      });
    }

    await Coupon.deleteOne({ _id: doc._id });

    await logAction({
      actorType: "admin",
      actorId: req.admin?.id,
      action: "coupon.deleted",
      targetType: "coupon",
      targetId: doc._id,
      meta: { code: doc.code },
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
};

// ---------------------------------------------------------------------
// User-facing - lets the buy-credits page show the discount before the
// buyer commits to checkout. The actual charge is still recomputed
// server-side again in payments/controller.js's createOrder.
// ---------------------------------------------------------------------

exports.validate = async (req, res, next) => {
  try {
    const { code, credits: creditsRequested } = req.body;
    const pkg = findPackage(creditsRequested);
    if (!pkg) {
      return res.status(400).json({ ok: false, message: "Unknown credit package" });
    }

    const { discountAmount, finalPrice } = await couponsService.validateCoupon(code, {
      userId: req.user.id,
      price: pkg.price,
    });

    return res.json({
      ok: true,
      code: String(code).trim().toUpperCase(),
      originalPrice: pkg.price,
      discountAmount,
      finalPrice,
    });
  } catch (err) {
    if (err instanceof couponsService.CouponError) {
      return res.status(err.statusCode || 400).json({ ok: false, message: err.message });
    }
    return next(err);
  }
};
