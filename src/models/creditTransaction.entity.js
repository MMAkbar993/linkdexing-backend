const mongoose = require("mongoose");

// The credit ledger. A user's balance is the running total of these entries
// (User.creditBalance is a cached copy, kept in sync in the same transaction
// as every insert here — see src/services/credits.js).
const creditTransactionSchema = new mongoose.Schema(
  {
    userId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "user",
      index: true,
    },
    // Positive = credits added (purchase, admin grant, refund).
    // Negative = credits spent (link submission, index check, API usage).
    // Usually a whole number (1 credit = 1 link submission), but index
    // checks are priced per-URL in fractions of a credit, so this allows
    // any non-zero amount. src/services/credits.js rounds to 2dp before
    // writing, so values stay clean.
    amount: {
      required: true,
      type: Number,
      validate: {
        validator: (v) => Number.isFinite(v) && v !== 0,
        message: "amount must be a non-zero number",
      },
    },
    // Balance immediately after this entry was applied. Lets the ledger be
    // read on its own, without recomputing a running sum, and gives every
    // row a self-contained audit trail.
    balanceAfter: {
      required: true,
      type: Number,
      min: 0,
    },
    type: {
      required: true,
      type: String,
      enum: [
        "purchase",
        "link_submission",
        "index_check",
        "api_usage",
        "admin_adjustment",
        "refund",
      ],
    },
    // Free-text context: order id, admin note, payment id, etc.
    reason: {
      type: String,
      trim: true,
    },
    // Set when the entry was made by an admin (manual adjustment) rather
    // than an automated debit/credit.
    adminId: {
      type: mongoose.Types.ObjectId,
      ref: "admin",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("creditTransaction", creditTransactionSchema);
