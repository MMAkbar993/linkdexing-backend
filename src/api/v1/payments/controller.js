const mongoose = require("mongoose");
const Payment = require("./models/payment.entity");
const paypal = require("../../../services/paypal");
const credits = require("../../../services/credits");
const { logAction } = require("../../../services/audit");
const { findPackage } = require("../../../config/creditPackages");

// Marks a Payment completed and credits the account, exactly once, no
// matter which path gets there first: the buyer's browser calling
// /capture-order right after approving, or PayPal's webhook arriving
// independently (the durable path — it still arrives even if the browser
// was closed before the capture request finished). Whichever call wins the
// race does the crediting; the other sees paymentStatus already
// "completed" and does nothing.
async function completePayment(payment, captureId, rawCapture) {
  if (payment.paymentStatus === "completed") {
    return { alreadyCompleted: true, balance: await credits.getBalance(payment.userId) };
  }

  const session = await mongoose.startSession();
  try {
    let balance;

    await session.withTransaction(async () => {
      // The conditional filter is the actual guard: if another request
      // already flipped this to "completed" between our read above and
      // now, this update matches nothing and we fall through having
      // credited nothing.
      const updated = await Payment.findOneAndUpdate(
        { _id: payment._id, paymentStatus: { $ne: "completed" } },
        { paymentStatus: "completed", paypalCaptureId: captureId, rawCapture },
        { new: true, session }
      );

      if (!updated) {
        balance = await credits.getBalance(payment.userId);
        return;
      }

      const totalCredits = payment.credits + (payment.bonusCredits || 0);
      const result = await credits.credit(payment.userId, totalCredits, "purchase", {
        reason: `payment ${payment._id}`,
        session,
      });
      balance = result.balance;
    });

    await logAction({
      actorType: "system",
      action: "payment.completed",
      targetType: "payment",
      targetId: payment._id,
      meta: { userId: payment.userId, credits: payment.credits, amount: payment.amount },
    });

    return { alreadyCompleted: false, balance };
  } finally {
    session.endSession();
  }
}

// Step 1 of checkout: the price is looked up from CREDIT_PACKAGES using only
// the package's credit count — a client can never supply its own price.
exports.createOrder = async (req, res, next) => {
  try {
    const { credits: creditsRequested } = req.body;
    const pkg = findPackage(creditsRequested);

    if (!pkg) {
      return res.status(400).json({
        ok: false,
        message: "Unknown credit package",
      });
    }

    // Pre-generate the id so PayPal's order can reference our record from
    // the start, then insert the Payment once we know PayPal's order id too
    // — this avoids ever writing a placeholder value into the unique
    // paypalOrderId field, which two simultaneous checkouts could collide on.
    const paymentId = new mongoose.Types.ObjectId();

    const order = await paypal.createOrder({
      amount: pkg.price,
      currency: "USD",
      referenceId: paymentId.toString(),
    });

    const payment = await Payment.create({
      _id: paymentId,
      userId: req.user.id,
      userEmail: req.user.email,
      paypalOrderId: order.id,
      amount: pkg.price,
      currency: "USD",
      credits: pkg.credits,
      bonusCredits: pkg.bonus || 0,
      paymentStatus: "pending",
    });

    return res.status(201).json({
      ok: true,
      paypalOrderId: order.id,
      paymentId: payment._id,
    });
  } catch (err) {
    return next(err);
  }
};

// Step 2 of checkout: called by the frontend right after the buyer approves
// the order in the PayPal popup. The webhook below covers the case where
// this call never happens (closed tab, network drop).
exports.captureOrder = async (req, res, next) => {
  try {
    const { paypalOrderId } = req.body;

    const payment = await Payment.findOne({
      paypalOrderId,
      userId: req.user.id,
    });

    if (!payment) {
      return res.status(404).json({
        ok: false,
        message: "Payment not found",
      });
    }

    if (payment.paymentStatus === "completed") {
      return res.json({ ok: true, balance: await credits.getBalance(req.user.id) });
    }

    let capture;
    try {
      capture = await paypal.captureOrder(paypalOrderId);
    } catch (err) {
      // A failure calling PayPal itself (declined, expired order, PayPal
      // outage, etc.) - log the real detail server-side, but never leak an
      // internal error string like "Request failed with status code ___" to
      // the client.
      console.error(
        "PayPal capture failed for order",
        paypalOrderId,
        err.response?.data || err.message
      );
      payment.paymentStatus = "failed";
      payment.rawCapture = err.response?.data || { error: err.message };
      await payment.save();
      return res.status(402).json({
        ok: false,
        message: "PayPal could not complete this payment. Please try again.",
      });
    }

    if (capture.status !== "COMPLETED") {
      payment.paymentStatus = "failed";
      payment.rawCapture = capture;
      await payment.save();
      return res.status(402).json({
        ok: false,
        message: "Payment was not completed",
      });
    }

    const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    const { balance } = await completePayment(payment, captureId, capture);

    return res.json({ ok: true, balance });
  } catch (err) {
    return next(err);
  }
};

// PayPal calls this directly — there is no user JWT on this request, so
// authenticity comes from verifyWebhookSignature instead. Until
// PAYPAL_WEBHOOK_ID is configured (it requires a public HTTPS URL registered
// with PayPal, which localhost can't be), this acknowledges receipt but
// deliberately does not act on the event, rather than crediting an
// unverified request.
exports.webhook = async (req, res) => {
  try {
    const { configured, verified } = await paypal.verifyWebhookSignature(
      req.headers,
      req.body
    );

    if (!configured) {
      console.warn(
        "PayPal webhook received but PAYPAL_WEBHOOK_ID is not set - ignoring."
      );
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (!verified) {
      return res.status(400).json({ ok: false, message: "Signature verification failed" });
    }

    const event = req.body;

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const capture = event.resource;
      const paypalOrderId = capture.supplementary_data?.related_ids?.order_id;

      const payment = await Payment.findOne({ paypalOrderId });
      if (payment) {
        await completePayment(payment, capture.id, capture);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("PayPal webhook handling failed:", err.message);
    // Still 200 - PayPal retries on non-2xx, and retrying won't fix a bug
    // on our side. The error is logged for us to investigate instead.
    return res.status(200).json({ ok: false });
  }
};

exports.myPayments = async (req, res, next) => {
  try {
    const payments = await Payment.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100);
    return res.json({ ok: true, payments });
  } catch (err) {
    return next(err);
  }
};

// Admin "Payment Logs" — filterable by status, paginated.
exports.listPayments = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) {
      filter.paymentStatus = req.query.status;
    }

    const [payments, total] = await Promise.all([
      Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Payment.countDocuments(filter),
    ]);

    return res.json({ ok: true, payments, page, limit, total });
  } catch (err) {
    return next(err);
  }
};
