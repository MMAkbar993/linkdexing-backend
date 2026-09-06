const AuditLog = require("../models/auditLog.entity");

// Fire-and-forget audit logging: a failure here must never break the
// request that triggered it, so this never throws — it just logs to the
// console if the write itself fails.
async function logAction({
  actorType,
  actorId,
  action,
  targetType,
  targetId,
  meta,
  session,
}) {
  try {
    await AuditLog.create(
      [{ actorType, actorId, action, targetType, targetId, meta }],
      { session }
    );
  } catch (err) {
    console.error("audit log write failed:", err.message);
  }
}

module.exports = { logAction };
