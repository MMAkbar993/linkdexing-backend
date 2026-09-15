const crypto = require("crypto");

const PREFIX = "lkdx_live_";

// The real key is shown to the user exactly once - only its hash is ever
// stored (apiKey.entity.js), so a database leak can't hand out working
// keys. keyPrefix is a short, safe-to-display slice used to recognize the
// key in the UI without exposing enough to reconstruct it.
function generateKey() {
  const raw = PREFIX + crypto.randomBytes(24).toString("hex");
  return {
    raw,
    hash: hashKey(raw),
    prefix: raw.slice(0, PREFIX.length + 8) + "…",
  };
}

function hashKey(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

module.exports = { generateKey, hashKey };
