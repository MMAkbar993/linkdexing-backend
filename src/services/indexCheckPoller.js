// Polls IndexChecker.link for pending batches and applies results as they
// come in. A simple interval loop rather than a BullMQ/Redis queue: their
// API already accepts a whole batch (hundreds of URLs) in one submission
// call and processes it on their side, so the only async work here is
// periodically asking "is it done yet" for however many batches are
// in flight - which a single process handles fine at this project's
// current volume. If that stops being true, this is the one place that
// would need to become a real queue; nothing else in the data model
// would need to change.
const IndexCheckBatch = require("../api/v1/indexcheck/models/indexCheckBatch.entity");
const IndexCheck = require("../api/v1/indexcheck/models/indexCheck.entity");
const Link = require("../api/v1/links/models/link.entity");
const indexChecker = require("./indexChecker");
const credits = require("./credits");

const POLL_INTERVAL_MS = 90 * 1000;
const RESULT_MAP = { 1: "indexed", 0: "not_indexed", "-1": "pending" };
// ~5 failed attempts (roughly 7-8 minutes at the interval above) before a
// batch is given up on rather than retried forever - covers a transient
// blip on their end without leaving a broken batch stuck "pending" indefinitely.
const MAX_POLL_FAILURES = 5;

let running = false;

async function pollOnce() {
  if (running) return; // don't overlap if one poll cycle runs long
  running = true;

  try {
    const pending = await IndexCheckBatch.find({
      status: "pending",
      externalProjectId: { $ne: null },
    }).limit(25);

    for (const batch of pending) {
      try {
        await applyProjectResult(batch);
      } catch (err) {
        await handlePollFailure(batch, err);
      }
    }
  } finally {
    running = false;
  }
}

async function handlePollFailure(batch, err) {
  console.error(
    `Index check poll failed for batch ${batch._id} (attempt ${
      batch.pollFailures + 1
    }/${MAX_POLL_FAILURES}):`,
    err.message
  );

  batch.pollFailures += 1;

  if (batch.pollFailures < MAX_POLL_FAILURES) {
    await batch.save();
    return;
  }

  // Given up - refund whatever's left uncounted and mark it failed, rather
  // than silently retrying forever and leaving the user's credits gone with
  // nothing to show for it.
  batch.status = "failed";
  batch.errorMessage =
    "The index checking service stopped responding for this batch. Your credits were refunded.";
  await batch.save();

  await credits.credit(batch.userId, batch.creditsCharged, "refund", {
    reason: `index check batch ${batch._id} gave up after repeated poll failures`,
  });

  console.error(
    `Index check batch ${batch._id} gave up after ${MAX_POLL_FAILURES} failed polls - refunded ${batch.creditsCharged} credit(s).`
  );
}

async function applyProjectResult(batch) {
  const { urls, statistics } = await indexChecker.getProject(
    batch.externalProjectId
  );

  const checks = await IndexCheck.find({ batchId: batch._id });

  const bulkOps = [];
  const linkUpdates = []; // { linkId, indexStatus }

  for (const check of checks) {
    const raw = urls[check.url];
    const result = RESULT_MAP[String(raw)];
    if (!result || result === check.result) continue;

    bulkOps.push({
      updateOne: {
        filter: { _id: check._id },
        update: {
          result,
          checkedAt: result === "pending" ? undefined : new Date(),
        },
      },
    });

    if (check.linkId) {
      linkUpdates.push({ linkId: check.linkId, indexStatus: result });
    }
  }

  // Their aggregate says done (pending: 0) can be true even though some of
  // our rows never found a matching key above (see the enum comment on
  // IndexCheck.result) - normalized input is the known case, but treat any
  // mismatch the same way: resolve it to "unmatched" rather than leaving it
  // on "pending" forever once there's nothing left to wait for.
  if (statistics.pending === 0) {
    for (const check of checks) {
      const alreadyHandled = bulkOps.some((op) =>
        op.updateOne.filter._id.equals(check._id)
      );
      if (alreadyHandled || check.result !== "pending") continue;

      bulkOps.push({
        updateOne: {
          filter: { _id: check._id },
          update: { result: "unmatched", checkedAt: new Date() },
        },
      });
      if (check.linkId) {
        linkUpdates.push({ linkId: check.linkId, indexStatus: "unmatched" });
      }
    }
  }

  if (bulkOps.length > 0) {
    await IndexCheck.bulkWrite(bulkOps);
  }

  for (const { linkId, indexStatus } of linkUpdates) {
    await Link.updateOne(
      { _id: linkId },
      { indexStatus, indexCheckedAt: new Date() }
    );
  }

  batch.indexedCount = statistics.indexed;
  batch.notIndexedCount = statistics.not_indexed;
  batch.pendingCount = statistics.pending;
  batch.pollFailures = 0; // a successful poll clears any prior failure streak

  if (statistics.pending === 0) {
    batch.status = "completed";
    batch.completedAt = new Date();
  }

  await batch.save();
}

let intervalHandle = null;

function start() {
  if (intervalHandle) return; // already running - don't double-schedule
  intervalHandle = setInterval(pollOnce, POLL_INTERVAL_MS);
  // Run once shortly after boot too, rather than waiting a full interval.
  setTimeout(pollOnce, 5000);
}

function stop() {
  clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = { start, stop, pollOnce };
