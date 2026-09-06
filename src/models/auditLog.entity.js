const mongoose = require("mongoose");

// One generic collection for every action worth being able to answer
// "who did this, and when" about later: admin actions, credit adjustments,
// and (from Phase 1 onward) payments and API usage.
const auditLogSchema = new mongoose.Schema(
  {
    actorType: {
      required: true,
      type: String,
      enum: ["admin", "user", "system"],
    },
    // Omitted for actorType "system" (e.g. an automated job).
    actorId: {
      type: mongoose.Types.ObjectId,
      refPath: "actorType",
    },
    action: {
      required: true,
      type: String,
      trim: true,
    },
    targetType: {
      type: String,
      trim: true,
    },
    targetId: {
      type: mongoose.Types.ObjectId,
    },
    // Arbitrary extra context (previous/new values, IP, etc).
    meta: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

auditLogSchema.index({ targetType: 1, targetId: 1 });
auditLogSchema.index({ actorType: 1, actorId: 1 });

module.exports = mongoose.model("auditLog", auditLogSchema);
