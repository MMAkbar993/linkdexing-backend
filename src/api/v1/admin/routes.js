const router = require("express").Router();
const {
  login,
  isAuthenticated,
  checkAuthStatus,
  isAdmin,
  createAdmin,
  listAdmins,
  getSettings,
  updateSettings,
} = require("./controller");
const { login: loginLimiter } = require("../../../middleware/rateLimiters");

router.post("/", loginLimiter, login);
router.get("/me", checkAuthStatus, isAuthenticated);

router.route("/admins").get(checkAuthStatus, isAdmin, listAdmins).post(
  checkAuthStatus,
  isAdmin,
  createAdmin
);

router
  .route("/settings")
  .get(checkAuthStatus, isAdmin, getSettings)
  .post(checkAuthStatus, isAdmin, updateSettings);

module.exports = router;
