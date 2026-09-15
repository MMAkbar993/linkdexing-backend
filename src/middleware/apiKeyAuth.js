// Authenticates and rate-limits requests to the developer REST API
// (src/api/v1/dev/routes.js). A per-key in-memory counter rather than
// Redis or express-rate-limit's static config - the limits are
// admin-adjustable at runtime (src/services/settings.js), and this app
// runs as a single process, same reasoning as indexCheckPoller.js skipping
// a real queue: no new infrastructure until the current approach actually
// can't keep up.
const ApiKey = require("../api/v1/dev/models/apiKey.entity");
const User = require("../api/v1/users/models/user.entity");
const { hashKey } = require("../services/apiKeys");
const settings = require("../services/settings");

function extractKey(req) {
  const header = req.headers["x-api-key"];
  if (header) return String(header).trim();

  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();

  return null;
}

async function authenticate(req, res, next) {
  try {
    const raw = extractKey(req);
    if (!raw) {
      return res.status(401).json({
        ok: false,
        message: "Provide an API key via the Authorization: Bearer header or X-API-Key header.",
      });
    }

    const apiKey = await ApiKey.findOne({ keyHash: hashKey(raw), isActive: true });
    if (!apiKey) {
      return res.status(401).json({ ok: false, message: "Invalid or revoked API key." });
    }

    const user = await User.findById(apiKey.userId);
    if (!user) {
      return res.status(401).json({ ok: false, message: "Invalid or revoked API key." });
    }

    req.apiKey = apiKey;
    req.apiUser = user;
    // Not awaited - a slow write here shouldn't add latency to every call.
    ApiKey.updateOne({ _id: apiKey._id }, { lastUsedAt: new Date() }).catch(() => {});

    return next();
  } catch (err) {
    return next(err);
  }
}

const minuteCounters = new Map(); // apiKeyId -> { windowStart, count }
const dayCounters = new Map();

function withinLimit(map, key, windowMs, max) {
  const now = Date.now();
  let entry = map.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    entry = { windowStart: now, count: 0 };
    map.set(key, entry);
  }
  entry.count += 1;
  return entry.count <= max;
}

async function rateLimit(req, res, next) {
  try {
    const { apiRateLimitPerMinute, apiRateLimitPerDay } = await settings.getSettings();
    const key = req.apiKey._id.toString();

    const okMinute = withinLimit(minuteCounters, key, 60 * 1000, apiRateLimitPerMinute);
    const okDay = withinLimit(dayCounters, key, 24 * 60 * 60 * 1000, apiRateLimitPerDay);

    if (!okMinute) {
      return res.status(429).json({
        ok: false,
        message: `Rate limit exceeded: ${apiRateLimitPerMinute} requests per minute.`,
      });
    }
    if (!okDay) {
      return res.status(429).json({
        ok: false,
        message: `Rate limit exceeded: ${apiRateLimitPerDay} requests per day.`,
      });
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { authenticate, rateLimit };
