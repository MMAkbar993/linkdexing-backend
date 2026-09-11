const mongoose = require("mongoose");

// One document per URL within an IndexCheckBatch. Matches the PRD's
// IndexCheck collection (userId, url, result, checkedAt, source), with
// batchId added since results are always created and updated as part of one
// batch rather than one at a time.
const indexCheckSchema = new mongoose.Schema(
  {
    batchId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "indexCheckBatch",
      index: true,
    },
    userId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "user",
      index: true,
    },
    // Set only for source: "archive" batches - the specific submitted link
    // this result belongs to, so the Archive page can show status per link.
    linkId: {
      type: mongoose.Types.ObjectId,
      ref: "link",
      index: true,
    },
    url: {
      required: true,
      type: String,
      trim: true,
    },
    result: {
      type: String,
      enum: ["pending", "indexed", "not_indexed"],
      default: "pending",
    },
    source: {
      type: String,
      enum: ["archive", "standalone"],
      required: true,
    },
    checkedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("indexCheck", indexCheckSchema);
