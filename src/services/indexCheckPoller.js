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

const POLL_INTERVAL_MS = 90 * 1000;
const RESULT_MAP = { 1: "indexed", 0: "not_indexed", "-1": "pending" };

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
        console.error(
          `Index check poll failed for batch ${batch._id}:`,
          err.message
        );
      }
    }
  } finally {
    running = false;
  }
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
