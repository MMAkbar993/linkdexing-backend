const mongoose = require("mongoose");
const User = require("../users/models/user.entity");
const Order = require("./models/order.entity");
const Link = require("../links/models/link.entity");
const credits = require("../../../services/credits");

const DEFAULT_PAGE_SIZE = 50;
const USER_SCOPED_PAGE_SIZE = 200;
// Same shape as frontend/src/utils/csv.js's URL_LIKE - kept in sync by hand,
// since the two apps don't share code. Rejecting non-URLs here (not just in
// the form) matters because IndexChecker.link still "checks" malformed
// input rather than erroring on it, and the result can never be matched
// back to the original string - see indexCheckPoller.js's "unmatched" state.
const URL_LIKE = /^(https?:\/\/|www\.)\S+$/i;

function parsePaging(query, defaultLimit) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

// Shared by the browser "Add Links" form and the developer API's /submit
// endpoint - one credit is spent per non-blank URL, and the order, the Link
// documents (one per URL) and the credit debit all happen in a single
// transaction, so a failure partway through can't leave a user debited with
// no order, or an order with no matching ledger entry.
//
// Returns { order, urls }. Throws credits.InsufficientCreditsError, or a
// plain Error with .statusCode set for a validation failure - callers turn
// that into the right HTTP response for their own response shape.
async function submitLinks({ userId, links, dripfeed, transactionType = "link_submission" }) {
  const urls = (links || "")
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    const err = new Error("At least one link is required");
    err.statusCode = 400;
    throw err;
  }

  const invalid = urls.filter((url) => !URL_LIKE.test(url));
  if (invalid.length > 0) {
    const err = new Error(
      `Every line must be a full URL, starting with http://, https://, or www. (${invalid.length} line(s) didn't match)`
    );
    err.statusCode = 400;
    throw err;
  }

  const session = await mongoose.startSession();
  try {
    let order;

    await session.withTransaction(async () => {
      [order] = await Order.create([{ userId, links, dripfeed }], { session });

      await Link.insertMany(
        urls.map((url) => ({ orderId: order._id, userId, url, dripfeed })),
        { session }
      );

      await credits.debit(userId, urls.length, transactionType, {
        reason: `order ${order._id}`,
        session,
      });

      await User.findByIdAndUpdate(
        userId,
        { $inc: { totalLinks: urls.length } },
        { session }
      );
    });

    return { order, urls };
  } finally {
    session.endSession();
  }
}

exports.submitLinks = submitLinks;

exports.createOrder = async (req, res, next) => {
  const { links, dripfeed } = req.body;

  try {
    const { order, urls } = await submitLinks({
      userId: req.user.id,
      links,
      dripfeed,
    });
    return res.status(201).json({ ok: true, order, linksSubmitted: urls.length });
  } catch (err) {
    if (err instanceof credits.InsufficientCreditsError) {
      return res.status(err.statusCode).json({
        ok: false,
        message: err.message,
      });
    }
    if (err.statusCode) {
      return res.status(err.statusCode).json({ ok: false, message: err.message });
    }
    return next(err);
  }
};

// Process order in Admin (order completed)
exports.processOrder = async (req, res, next) => {
  try {
    const { orderIds } = req.body;

    for (const orderId of orderIds) {
      const order = await Order.findById(orderId);

      if (!order) {
        return res.status(404).json({
          ok: false,
          message: "Order not found",
        });
      }

      order.isProcessed = true;
      await order.save();
      await Link.updateMany({ orderId }, { isProcessed: true });
    }

    return res.json({
      ok: true,
    });
  } catch (err) {
    return next(err);
  }
};

exports.getOrders = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePaging(req.query, DEFAULT_PAGE_SIZE);

    const [orders, total] = await Promise.all([
      Order.find()
        .populate("userId", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(),
    ]);

    return res.json({
      ok: true,
      orders,
      page,
      limit,
      total,
    });
  } catch (err) {
    return next(err);
  }
};

exports.getOrdersByUser = async (req, res, next) => {
  try {
    const { id } = req.user;
    const { page, limit, skip } = parsePaging(req.query, USER_SCOPED_PAGE_SIZE);

    const [orders, total] = await Promise.all([
      Order.find({ userId: id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments({ userId: id }),
    ]);

    return res.json({
      ok: true,
      orders,
      page,
      limit,
      total,
    });
  } catch (err) {
    return next(err);
  }
};

exports.getOrderLinks = async (req, res, next) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Invalid order id",
      });
    }

    const linkDocs = await Link.find({ orderId }).sort({ createdAt: 1 });

    // Orders created before scripts/migrate-links.js ran won't have Link
    // documents yet — fall back to the original blob so they still work.
    const links =
      linkDocs.length > 0
        ? linkDocs.map((doc) => doc.url)
        : (order.links || "").split("\n");

    return res.json({
      ok: true,
      links,
    });
  } catch (err) {
    return next(err);
  }
};

// Admin "Submissions" view: every order created on one calendar day (UTC),
// with the submitting user and link count — e.g. "who submitted how many
// links, and over how many drip-feed days, on 9/8/26". Relies on the
// createdAt index on the Order schema to stay fast at 100k+ rows.
exports.getOrdersByDate = async (req, res, next) => {
  try {
    const { date } = req.params;

    const start = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({
        ok: false,
        message: "date must be in YYYY-MM-DD format",
      });
    }
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const orders = await Order.find({
      createdAt: { $gte: start, $lt: end },
    })
      .populate("userId", "name email")
      .sort({ createdAt: -1 });

    const submissions = orders.map((order) => {
      const linkCount = (order.links || "")
        .split("\n")
        .map((url) => url.trim())
        .filter(Boolean).length;

      return {
        orderId: order._id,
        user: order.userId
          ? { name: order.userId.name, email: order.userId.email }
          : null,
        linkCount,
        dripfeed: order.dripfeed,
        isProcessed: order.isProcessed,
        createdAt: order.createdAt,
      };
    });

    // Highest link count first, matching how the Users list is sorted.
    submissions.sort((a, b) => b.linkCount - a.linkCount);

    return res.json({
      ok: true,
      date,
      submissions,
      totalLinks: submissions.reduce((sum, s) => sum + s.linkCount, 0),
    });
  } catch (err) {
    return next(err);
  }
};

exports.getOrdersByDripfeed = async (req, res, next) => {
  try {
    const { dripfeed } = req.params;

    let orders = await Order.find({
      dripfeed,
    }).select(["links", "isProcessed"]);

    orders = orders.filter((order) => !order.isProcessed);

    return res.json({
      ok: true,
      orders,
    });
  } catch (err) {
    return next(err);
  }
};
