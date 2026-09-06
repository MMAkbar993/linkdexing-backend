const router = require("express").Router();
const {
  login,
  isAuthenticated,
  checkAuthStatus,
  isAdmin,
  createAdmin,
  listAdmins,
} = require("./controller");
const { login: loginLimiter } = require("../../../middleware/rateLimiters");

router.post("/", loginLimiter, login);
router.get("/me", checkAuthStatus, isAuthenticated);

router.route("/admins").get(checkAuthStatus, isAdmin, listAdmins).post(
  checkAuthStatus,
  isAdmin,
  createAdmin
);

module.exports = router;
