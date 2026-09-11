const mongoose = require("mongoose");
const User = require("../api/v1/users/models/user.entity");
const CreditTransaction = require("../models/creditTransaction.entity");

// Requires MongoDB to be a replica set (any Atlas cluster, including the
// free tier, qualifies) — that's what makes the balance update and the
// ledger insert below atomic. A standalone mongod will throw here.
class InsufficientCreditsError extends Error {
  constructor(message = "Insufficient credits") {
    super(message);
    this.name = "InsufficientCreditsError";
    this.statusCode = 402;
  }
}

// Applies `delta` (positive to add, negative to spend) to a user's credit
// balance and writes a matching ledger entry, atomically. Runs inside
// `options.session` if one is given — so it can be combined with other
// writes in the same transaction (e.g. creating an order) — otherwise opens
// and commits its own.
// Credits are usually whole numbers (1 credit = 1 link submission), but the
// index checker prices at 0.1 credit/URL, so this accepts any amount to two
// decimal places rather than integers only. Rounded here, once, before it
// ever reaches Mongo, so repeated fractional charges don't accumulate
// floating-point noise (0.1 + 0.2 style drift) in the stored balance.
function round2(n) {
  return Math.round(n * 100) / 100;
}

async function applyCredits(
  userId,
  delta,
  type,
  { reason, adminId, session } = {}
) {
  delta = round2(delta);
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("delta must be a non-zero number");
  }

  const run = async (activeSession) => {
    const query = { _id: userId };
    if (delta < 0) {
      // Guard the overdraft in the query filter itself, so this is race-safe
      // under concurrent requests rather than "checked, then updated".
      query.creditBalance = { $gte: -delta };
    }

    // creditsPurchased is a lifetime counter - it only ever goes up, on any
    // positive grant (PayPal purchase or manual admin add), and is never
    // reduced when credits are spent. That's what makes it different from
    // creditBalance, which is the current spendable amount.
    const inc = { creditBalance: delta };
    if (delta > 0) {
      inc.creditsPurchased = delta;
    }

    const user = await User.findOneAndUpdate(
      query,
      { $inc: inc },
      { new: true, session: activeSession }
    );

    if (!user) {
      const exists = await User.exists({ _id: userId }).session(
        activeSession
      );
      if (!exists) throw new Error("User not found");
      throw new InsufficientCreditsError();
    }

    const [entry] = await CreditTransaction.create(
      [
        {
          userId,
          amount: delta,
          balanceAfter: user.creditBalance,
          type,
          reason,
          adminId,
        },
      ],
      { session: activeSession }
    );

    return { balance: user.creditBalance, entry };
  };

  if (session) {
    return run(session);
  }

  const ownSession = await mongoose.startSession();
  try {
    let result;
    await ownSession.withTransaction(() => run(ownSession).then((r) => (result = r)));
    return result;
  } finally {
    ownSession.endSession();
  }
}

function debit(userId, amount, type, opts) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number");
  }
  return applyCredits(userId, -amount, type, opts);
}

function credit(userId, amount, type, opts) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number");
  }
  return applyCredits(userId, amount, type, opts);
}

async function getBalance(userId) {
  const user = await User.findById(userId).select("creditBalance");
  if (!user) throw new Error("User not found");
  return user.creditBalance;
}

module.exports = { debit, credit, getBalance, InsufficientCreditsError };
