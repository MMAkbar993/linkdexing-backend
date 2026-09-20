const router = require("express").Router();
const { checkAuthStatus, requireAdmin, isNotRestrict } = require("../users/controller");
const { listCoupons, createCoupon, updateCoupon, deleteCoupon, validate } = require("./controller");

// User-facing - preview a discount on the buy-credits page before checkout.
router.post("/validate", checkAuthStatus, isNotRestrict, validate);

// Admin CRUD.
router.get("/", checkAuthStatus, requireAdmin, listCoupons);
router.post("/", checkAuthStatus, requireAdmin, createCoupon);
router.patch("/:id", checkAuthStatus, requireAdmin, updateCoupon);
router.delete("/:id", checkAuthStatus, requireAdmin, deleteCoupon);

module.exports = router;
