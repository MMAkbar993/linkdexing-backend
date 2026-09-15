const router = require("express").Router();
const { checkAuthStatus } = require("../users/controller");
const apiKeyAuth = require("../../../middleware/apiKeyAuth");
const apiRequestLogger = require("../../../middleware/apiRequestLogger");
const {
  generateKey,
  getKey,
  revokeKey,
  myUsageDashboard,
  me,
  submit,
  submissionStatus,
  archive,
  creditBalance,
  indexCheck,
  indexCheckStatus,
  usage,
} = require("./controller");

// --- Key management - the app's own logged-in session, not an API key ---
router.post("/keys/generate", checkAuthStatus, generateKey);
router.get("/keys", checkAuthStatus, getKey);
router.delete("/keys", checkAuthStatus, revokeKey);
router.get("/usage", checkAuthStatus, myUsageDashboard);

// --- The actual REST API - authenticated by API key ---
// Base path once mounted (see app.js): /api/v1/dev/api
const api = require("express").Router();
api.use(apiKeyAuth.authenticate, apiKeyAuth.rateLimit, apiRequestLogger);

api.get("/me", me);
api.post("/submit", submit);
api.get("/submissions/:id", submissionStatus);
api.get("/archive", archive);
api.get("/credits", creditBalance);
api.post("/index-check", indexCheck);
api.get("/index-check/:id", indexCheckStatus);
api.get("/usage", usage);

router.use("/api", api);

module.exports = router;
