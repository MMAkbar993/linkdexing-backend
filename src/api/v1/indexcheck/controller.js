const mongoose = require("mongoose");
const IndexCheckBatch = require("./models/indexCheckBatch.entity");
const IndexCheck = require("./models/indexCheck.entity");
const Link = require("../links/models/link.entity");
const Order = require("../orders/models/order.entity");
const indexChecker = require("../../../services/indexChecker");
const credits = require("../../../services/credits");
const settings = require("../../../services/settings");

const MAX_URLS_PER_BATCH = 2000; // matches what IndexChecker.link accepts comfortably in one project

function normalizeUrls(raw) {
  return [...new Set((raw || []).map((u) => String(u).trim()).filter(Boolean))];
}

// Shared by both Part A (archive re-check) and Part B (standalone check).
// Charges credits up front, creates the batch + per-URL rows, and submits
// to IndexChecker.link in one call - the poller (indexCheckPoller.js) picks
// up the result later. If the third-party call itself fails (bad key, their
// API down), the charge is refunded rather than left taken with nothing to
// show for it.
async function createBatch({ userId, urls, source, orderId, linkIds }) {
  const cleanUrls = normalizeUrls(urls);

  if (cleanUrls.length === 0) {
    const err = new Error("At least one URL is required");
    err.statusCode = 400;
    throw err;
  }
  if (cleanUrls.length > MAX_URLS_PER_BATCH) {
    const err = new Error(`A single check is limited to ${MAX_URLS_PER_BATCH} URLs`);
    err.statusCode = 400;
    throw err;
  }

  const { costPerIndexCheck } = await settings.getSettings();
  const cost = Math.round(cleanUrls.length * costPerIndexCheck * 100) / 100;

  const session = await mongoose.startSession();
  let batch;

  try {
    await session.withTransaction(async () => {
      await credits.debit(userId, cost, "index_check", {
        reason: `index check: ${cleanUrls.length} URL(s)`,
        session,
      });

      [batch] = await IndexCheckBatch.create(
        [
          {
            userId,
            source,
            orderId,
            status: "pending",
            totalUrls: cleanUrls.length,
            pendingCount: cleanUrls.length,
            creditsCharged: cost,
          },
        ],
        { session }
      );

      await IndexCheck.insertMany(
        cleanUrls.map((url, i) => ({
          batchId: batch._id,
          userId,
          linkId: linkIds ? linkIds[i] : undefined,
          url,
          source,
          result: "pending",
        })),
        { session }
      );

      if (source === "archive" && linkIds) {
        await Link.updateMany(
          { _id: { $in: linkIds } },
          { indexStatus: "pending" },
          { session }
        );
      }
    });
  } finally {
    session.endSession();
  }

  // Submit to IndexChecker.link outside the transaction - it's an external
  // call, and transactions shouldn't hold open across one.
  try {
    const { projectId } = await indexChecker.createProject(
      `linkdexing-${batch._id}`,
      cleanUrls
    );
    batch.externalProjectId = projectId;
    await batch.save();
  } catch (err) {
    // The charge already happened - refund it and mark the batch failed
    // rather than leaving the user's credits gone with nothing to show.
    await credits.credit(userId, cost, "refund", {
      reason: `index check submission failed for batch ${batch._id}`,
    });
    batch.status = "failed";
    batch.errorMessage =
      "Could not submit to the index checking service. Your credits were refunded.";
    await batch.save();
    const refundedErr = new Error(batch.errorMessage);
    refundedErr.statusCode = 502;
    throw refundedErr;
  }

  return batch;
}

// Part B: standalone check of any URLs, textarea or CSV-derived.
exports.checkStandalone = async (req, res, next) => {
  try {
    const { urls } = req.body;
    const batch = await createBatch({
      userId: req.user.id,
      urls,
      source: "standalone",
    });
    return res.status(201).json({ ok: true, batch });
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

// Part A: re-check the index status of links from one of the user's own
// orders. Only ever operates on the caller's own links.
exports.checkOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!order) {
      return res.status(404).json({ ok: false, message: "Order not found" });
    }

    const links = await Link.find({ orderId }).select("url");
    if (links.length === 0) {
      return res.status(400).json({ ok: false, message: "This order has no links" });
    }

    const batch = await createBatch({
      userId: req.user.id,
      urls: links.map((l) => l.url),
      linkIds: links.map((l) => l._id),
      source: "archive",
      orderId,
    });
    return res.status(201).json({ ok: true, batch });
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

// Cost preview before the user commits - lets the UI show "this will cost
// N credits" before they submit.
exports.estimateCost = async (req, res, next) => {
  try {
    const { count } = req.query;
    const n = Math.max(0, parseInt(count, 10) || 0);
    const { costPerIndexCheck } = await settings.getSettings();
    return res.json({
      ok: true,
      costPerIndexCheck,
      totalCost: Math.round(n * costPerIndexCheck * 100) / 100,
    });
  } catch (err) {
    return next(err);
  }
};

exports.myBatches = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const [batches, total] = await Promise.all([
      IndexCheckBatch.find({ userId: req.user.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      IndexCheckBatch.countDocuments({ userId: req.user.id }),
    ]);

    return res.json({ ok: true, batches, page, limit, total });
  } catch (err) {
    return next(err);
  }
};

exports.getBatch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const batch = await IndexCheckBatch.findOne({ _id: id, userId: req.user.id });
    if (!batch) {
      return res.status(404).json({ ok: false, message: "Batch not found" });
    }
    const checks = await IndexCheck.find({ batchId: id }).sort({ url: 1 });
    return res.json({ ok: true, batch, checks });
  } catch (err) {
    return next(err);
  }
};

// One batch per order, most recent first - lets the Links Archive page ask
// "has this order been checked, and what's the result" in one query.
exports.batchForOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const batch = await IndexCheckBatch.findOne({
      orderId,
      userId: req.user.id,
    }).sort({ createdAt: -1 });
    return res.json({ ok: true, batch: batch || null });
  } catch (err) {
    return next(err);
  }
};
