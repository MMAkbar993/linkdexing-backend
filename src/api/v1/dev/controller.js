const ApiKey = require("./models/apiKey.entity");
const ApiRequestLog = require("./models/apiRequestLog.entity");
const Order = require("../orders/models/order.entity");
const Link = require("../links/models/link.entity");
const { submitLinks } = require("../orders/controller");
const { createBatch } = require("../indexcheck/controller");
const IndexCheckBatch = require("../indexcheck/models/indexCheckBatch.entity");
const IndexCheck = require("../indexcheck/models/indexCheck.entity");
const { generateKey } = require("../../../services/apiKeys");
const credits = require("../../../services/credits");

// ---------------------------------------------------------------------
// Key management - authenticated by the normal browser session
// (checkAuthStatus), not by an API key. A user manages their own key from
// inside the app the same way they manage anything else in their account.
// ---------------------------------------------------------------------

// Generates a new key, revoking whatever key the user already had - only
// one active key per account. The raw key is returned exactly once here;
// after this response, only its prefix is ever shown again.
exports.generateKey = async (req, res, next) => {
  try {
    await ApiKey.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });

    const { raw, hash, prefix } = generateKey();
    await ApiKey.create({ userId: req.user.id, keyHash: hash, keyPrefix: prefix });

    return res.status(201).json({ ok: true, key: raw, keyPrefix: prefix });
  } catch (err) {
    return next(err);
  }
};

exports.getKey = async (req, res, next) => {
  try {
    const key = await ApiKey.findOne({ userId: req.user.id, isActive: true }).select(
      "keyPrefix createdAt lastUsedAt"
    );
    return res.json({ ok: true, key: key || null });
  } catch (err) {
    return next(err);
  }
};

exports.revokeKey = async (req, res, next) => {
  try {
    await ApiKey.updateMany({ userId: req.user.id, isActive: true }, { isActive: false });
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
};

// Dashboard view of API usage - browser session, so the page can show this
// without the user needing to paste their own key into their own app.
exports.myUsageDashboard = async (req, res, next) => {
  try {
    const stats = await usageStatsFor(req.user.id);
    return res.json({ ok: true, ...stats });
  } catch (err) {
    return next(err);
  }
};

async function usageStatsFor(userId) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [requests, creditsAgg, balance] = await Promise.all([
    ApiRequestLog.countDocuments({ userId, createdAt: { $gte: since } }),
    ApiRequestLog.aggregate([
      { $match: { userId, createdAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: "$creditsCharged" } } },
    ]),
    credits.getBalance(userId),
  ]);
  return {
    requestsLast30Days: requests,
    creditsUsedLast30Days: creditsAgg[0]?.total || 0,
    creditBalance: balance,
  };
}

// ---------------------------------------------------------------------
// The actual REST API - authenticated by API key
// (src/middleware/apiKeyAuth.js sets req.apiUser / req.apiKey).
// ---------------------------------------------------------------------

exports.me = async (req, res) => {
  return res.json({
    ok: true,
    user: { name: req.apiUser.name, email: req.apiUser.email },
    key: { prefix: req.apiKey.keyPrefix, createdAt: req.apiKey.createdAt },
  });
};

// POST /submit - Body: { urls, dripfeed, priority? }. `priority` is accepted
// but not yet implemented - see the note in the docs page.
exports.submit = async (req, res, next) => {
  try {
    const { urls, dripfeed } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ ok: false, message: "urls must be a non-empty array" });
    }
    if (!Number.isInteger(dripfeed) || dripfeed < 1 || dripfeed > 30) {
      return res.status(400).json({ ok: false, message: "dripfeed must be an integer from 1 to 30" });
    }

    const { order, urls: submitted } = await submitLinks({
      userId: req.apiUser.id,
      links: urls.join("\n"),
      dripfeed,
      transactionType: "link_submission",
    });

    res.locals.creditsCharged = submitted.length;

    return res.status(201).json({
      ok: true,
      submissionId: order._id,
      linksSubmitted: submitted.length,
      dripfeed: order.dripfeed,
      createdAt: order.createdAt,
    });
  } catch (err) {
    if (err instanceof credits.InsufficientCreditsError) {
      return res.status(err.statusCode).json({ ok: false, message: err.message });
    }
    if (err.statusCode) {
      return res.status(err.statusCode).json({ ok: false, message: err.message });
    }
    return next(err);
  }
};

// GET /submissions/:id
exports.submissionStatus = async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, userId: req.apiUser.id });
    if (!order) {
      return res.status(404).json({ ok: false, message: "Submission not found" });
    }

    const links = await Link.find({ orderId: order._id }).select("url isProcessed indexStatus");

    return res.json({
      ok: true,
      submissionId: order._id,
      dripfeed: order.dripfeed,
      isProcessed: order.isProcessed,
      createdAt: order.createdAt,
      links: links.map((l) => ({
        url: l.url,
        processed: l.isProcessed,
        indexStatus: l.indexStatus,
      })),
    });
  } catch (err) {
    return next(err);
  }
};

// GET /archive?page=&limit=
exports.archive = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      Order.find({ userId: req.apiUser.id })
        .select("dripfeed isProcessed createdAt links")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments({ userId: req.apiUser.id }),
    ]);

    return res.json({
      ok: true,
      page,
      limit,
      total,
      submissions: orders.map((o) => ({
        submissionId: o._id,
        dripfeed: o.dripfeed,
        isProcessed: o.isProcessed,
        createdAt: o.createdAt,
        linkCount: (o.links || "").split("\n").filter((l) => l.trim()).length,
      })),
    });
  } catch (err) {
    return next(err);
  }
};

// GET /credits
exports.creditBalance = async (req, res, next) => {
  try {
    const balance = await credits.getBalance(req.apiUser.id);
    return res.json({ ok: true, balance });
  } catch (err) {
    return next(err);
  }
};

// POST /index-check - Body: { urls }
exports.indexCheck = async (req, res, next) => {
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ ok: false, message: "urls must be a non-empty array" });
    }

    const batch = await createBatch({
      userId: req.apiUser.id,
      urls,
      source: "standalone",
    });

    res.locals.creditsCharged = batch.creditsCharged;

    return res.status(201).json({
      ok: true,
      batchId: batch._id,
      totalUrls: batch.totalUrls,
      creditsCharged: batch.creditsCharged,
      status: batch.status,
    });
  } catch (err) {
    if (err instanceof credits.InsufficientCreditsError) {
      return res.status(err.statusCode).json({ ok: false, message: err.message });
    }
    if (err.statusCode) {
      return res.status(err.statusCode).json({ ok: false, message: err.message });
    }
    return next(err);
  }
};

// GET /index-check/:id - poll for the result of a check started with
// POST /index-check.
exports.indexCheckStatus = async (req, res, next) => {
  try {
    const batch = await IndexCheckBatch.findOne({
      _id: req.params.id,
      userId: req.apiUser.id,
    });
    if (!batch) {
      return res.status(404).json({ ok: false, message: "Index check not found" });
    }

    const checks = await IndexCheck.find({ batchId: batch._id }).select("url result");

    return res.json({
      ok: true,
      batchId: batch._id,
      status: batch.status,
      totalUrls: batch.totalUrls,
      indexed: batch.indexedCount,
      notIndexed: batch.notIndexedCount,
      pending: batch.pendingCount,
      errorMessage: batch.errorMessage,
      results: checks.map((c) => ({ url: c.url, result: c.result })),
    });
  } catch (err) {
    return next(err);
  }
};

// GET /usage
exports.usage = async (req, res, next) => {
  try {
    const stats = await usageStatsFor(req.apiUser.id);
    return res.json({
      ok: true,
      requestsLast30Days: stats.requestsLast30Days,
      creditsUsedLast30Days: stats.creditsUsedLast30Days,
      creditsRemaining: stats.creditBalance,
    });
  } catch (err) {
    return next(err);
  }
};
