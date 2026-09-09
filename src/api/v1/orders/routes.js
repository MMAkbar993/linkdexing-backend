const { checkAuthStatus, isNotRestrict, requireAdmin } = require("../users/controller");
const {
  getOrdersByUser,
  createOrder,
  getOrders,
  getOrderLinks,
  getOrdersByDripfeed,
  getOrdersByDate,
  processOrder,
} = require("./controller");

const router = require("express").Router();

// Admin-only endpoints. checkAuthStatus alone accepts either a user or an
// admin token — requireAdmin narrows these three down to admin tokens only,
// since they expose or mutate every user's orders, not just the caller's own.
router.get("/all", checkAuthStatus, requireAdmin, getOrders);

router.get("/dripfeed/:dripfeed", checkAuthStatus, requireAdmin, getOrdersByDripfeed);

router.get("/by-date/:date", checkAuthStatus, requireAdmin, getOrdersByDate);

router.post("/process", checkAuthStatus, requireAdmin, processOrder);

router.get("/:orderId", checkAuthStatus, getOrderLinks);

router
  .route("/")
  .get(checkAuthStatus, getOrdersByUser)
  .post(checkAuthStatus, isNotRestrict, createOrder);

module.exports = router;
