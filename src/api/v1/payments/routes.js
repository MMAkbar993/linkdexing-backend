const router = require("express").Router();
const {
  checkAuthStatus,
  isNotRestrict,
  requireAdmin,
} = require("../users/controller");
const {
  createOrder,
  captureOrder,
  webhook,
  myPayments,
  listPayments,
} = require("./controller");

router.post("/create-order", checkAuthStatus, isNotRestrict, createOrder);

router.post("/capture-order", checkAuthStatus, isNotRestrict, captureOrder);

// Called by PayPal directly - no user token on this request. Authenticity
// comes from paypal.verifyWebhookSignature inside the controller instead.
router.post("/webhook", webhook);

router.get("/mine", checkAuthStatus, myPayments);

router.get("/", checkAuthStatus, requireAdmin, listPayments);

module.exports = router;
