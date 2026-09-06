// Backfills the Link collection from every existing Order's links blob.
// Safe to run more than once — orders that already have Link documents are
// skipped, so re-running only picks up orders created before this migration
// was deployed but somehow missed.
//
// Usage:
//   node scripts/migrate-links.js
//
// Requires MONGODB_URI in the environment (loaded from backend/.env).

require("dotenv/config");
const mongoose = require("mongoose");
const Order = require("../src/api/v1/orders/models/order.entity");
const Link = require("../src/api/v1/links/models/link.entity");

const BATCH_SIZE = 500;

async function migrateOrder(order) {
  const alreadyMigrated = await Link.exists({ orderId: order._id });
  if (alreadyMigrated) {
    return { skipped: true, count: 0 };
  }

  const urls = (order.links || "")
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return { skipped: false, count: 0 };
  }

  await Link.insertMany(
    urls.map((url) => ({
      orderId: order._id,
      userId: order.userId,
      url,
      dripfeed: order.dripfeed,
      isProcessed: order.isProcessed,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    })),
    { ordered: false }
  );

  return { skipped: false, count: urls.length };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
  });
  console.log("Connected. Starting migration...");

  let processed = 0;
  let migrated = 0;
  let skipped = 0;
  let linksCreated = 0;

  const cursor = Order.find().sort({ _id: 1 }).cursor();

  let batch = [];
  const flush = async () => {
    for (const order of batch) {
      const result = await migrateOrder(order);
      processed += 1;
      if (result.skipped) {
        skipped += 1;
      } else {
        migrated += 1;
        linksCreated += result.count;
      }
    }
    batch = [];
  };

  for await (const order of cursor) {
    batch.push(order);
    if (batch.length >= BATCH_SIZE) {
      await flush();
      console.log(`...processed ${processed} orders so far`);
    }
  }
  await flush();

  console.log("Migration complete.");
  console.log(`  orders processed:      ${processed}`);
  console.log(`  orders migrated:       ${migrated}`);
  console.log(`  orders already done:   ${skipped}`);
  console.log(`  link documents created: ${linksCreated}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
