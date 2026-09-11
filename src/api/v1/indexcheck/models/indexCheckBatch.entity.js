const mongoose = require("mongoose");

// One document per "check these URLs" request - mirrors how Order works for
// link submission. Individual per-URL results live in IndexCheck
// (indexCheck.entity.js); this is the summary/progress record the UI polls.
const indexCheckBatchSchema = new mongoose.Schema(
  {
    userId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "user",
      index: true,
    },
    // "archive" = checking links the user already submitted through us
    // (Feature 2 Part A); "standalone" = arbitrary URLs pasted into the
    // Index Checker page (Part B).
    source: {
      type: String,
      enum: ["archive", "standalone"],
      required: true,
    },
    // The originating order, when source is "archive" - lets the Links
    // Archive page find "has this order been checked" without a separate
    // lookup.
    orderId: {
      type: mongoose.Types.ObjectId,
      ref: "order",
    },
    // IndexChecker.link's own project id - what we poll project/show with.
    externalProjectId: {
      type: String,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed"],
      default: "pending",
      index: true,
    },
    totalUrls: { type: Number, required: true },
    indexedCount: { type: Number, default: 0 },
    notIndexedCount: { type: Number, default: 0 },
    pendingCount: { type: Number, default: 0 },
    // What this batch cost, in credits - kept here even though it's also on
    // the CreditTransaction ledger, so the UI can show it without a join.
    creditsCharged: { type: Number, required: true },
    // Set if the third-party API call itself failed (bad key, their outage,
    // etc.) - the credits for a failed submission are refunded, and this is
    // shown to the user instead of leaving the batch stuck at "pending".
    errorMessage: { type: String },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("indexCheckBatch", indexCheckBatchSchema);
