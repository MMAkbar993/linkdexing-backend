const router = require("express").Router();
const {
  register,
  login,
  isAuthenticated,
  getUsers,
  checkAuthStatus,
  changePassword,
  deleteUser,
  isNotRestrict,
  restrictUser,
  verifyUser,
  sendForgotPasswordLink,
  resetPassword,
  sendOtp,
  verifyOtp,
  getMyCredits,
  adjustCredits,
  requireAdmin,
} = require("./controller");
const {
  login: loginLimiter,
  otp: otpLimiter,
  forgotPassword: forgotPasswordLimiter,
} = require("../../../middleware/rateLimiters");

// Admin-only: search/list/restrict/delete reach every account, not just the
// caller's own, so checkAuthStatus alone (which also accepts a plain user
// token) isn't enough here.
router.get("/search", checkAuthStatus, requireAdmin, getUsers);

router.post("/verify", verifyUser);

router.route("/").post(register);

router.post("/login", loginLimiter, login);

router.get("/isAuthenticated", isAuthenticated);

router.post("/change-password", checkAuthStatus, isNotRestrict, changePassword);

router.delete("/delete/:q", checkAuthStatus, requireAdmin, deleteUser);

router.post("/restrict/:id", checkAuthStatus, requireAdmin, restrictUser);

router.post("/forgot-password", forgotPasswordLimiter, sendForgotPasswordLink);

router.post("/reset-password", resetPassword);

router.post("/send-otp/:id", otpLimiter, sendOtp);

router.post("/verify-otp/:id", otpLimiter, verifyOtp);

router.get("/credits", checkAuthStatus, getMyCredits);

router.post("/credits/adjust/:id", checkAuthStatus, requireAdmin, adjustCredits);

module.exports = router;
