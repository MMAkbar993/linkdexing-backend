const router = require("express").Router();
const { checkAuthStatus, isNotRestrict } = require("../users/controller");
const {
  checkStandalone,
  checkOrder,
  estimateCost,
  myBatches,
  getBatch,
  batchForOrder,
} = require("./controller");

router.get("/estimate", checkAuthStatus, estimateCost);

router.get("/mine", checkAuthStatus, myBatches);

router.get("/for-order/:orderId", checkAuthStatus, batchForOrder);

router.get("/:id", checkAuthStatus, getBatch);

router.post("/standalone", checkAuthStatus, isNotRestrict, checkStandalone);

router.post("/order/:orderId", checkAuthStatus, isNotRestrict, checkOrder);

module.exports = router;
