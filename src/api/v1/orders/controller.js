const mongoose = require("mongoose");
const User = require("../users/models/user.entity");
const Order = require("./models/order.entity");
const Link = require("../links/models/link.entity");
const credits = require("../../../services/credits");

const DEFAULT_PAGE_SIZE = 50;
const USER_SCOPED_PAGE_SIZE = 200;

function parsePaging(query, defaultLimit) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

// Create order — one credit is spent per non-blank submitted link. The
// order, the Link documents (one per URL — this is what later phases query
// for per-URL index status) and the credit debit all happen in a single
// transaction, so a failure partway through can't leave a user debited with
// no order, or an order with no matching ledger entry.
exports.createOrder = async (req, res, next) => {
  const { links, dripfeed } = req.body;
  const { id } = req.user;

  const urls = (links || "")
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return res.status(400).json({
      ok: false,
      message: "At least one link is required",
    });
  }

  const session = await mongoose.startSession();

  try {
    let order;

    await session.withTransaction(async () => {
      [order] = await Order.create(
        [{ userId: id, links, dripfeed }],
        { session }
      );

      await Link.insertMany(
        urls.map((url) => ({
          orderId: order._id,
          userId: id,
          url,
          dripfeed,
        })),
        { session }
      );

      await credits.debit(id, urls.length, "link_submission", {
        reason: `order ${order._id}`,
        session,
      });

      await User.findByIdAndUpdate(
        id,
        { $inc: { totalLinks: urls.length } },
        { session }
      );
    });

    return res.status(201).json({
      ok: true,
      order,
    });
  } catch (err) {
    if (err instanceof credits.InsufficientCreditsError) {
      return res.status(err.statusCode).json({
        ok: false,
        message: `Not enough credits. This submission needs ${urls.length} credits.`,
      });
    }
    return next(err);
  } finally {
    session.endSession();
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
