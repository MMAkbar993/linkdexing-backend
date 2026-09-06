// The prices a client is allowed to pay for credits. A checkout request only
// ever names a package by its `credits` value — the price is always looked
// up here, server-side, and never trusted from the request body.
//
// Keep this in sync with the `packages` array in
// frontend/src/content/site.js (the Buy Credits page) — the two lists are
// duplicated because the frontend and backend are separate deployables with
// no shared package. If a package is added or repriced on one side, it needs
// updating on the other, or the buy page will offer a package the backend
// doesn't recognize.
const CREDIT_PACKAGES = [
  { credits: 200, price: 10 },
  { credits: 500, price: 25 },
  { credits: 1000, price: 50 },
  { credits: 2000, price: 100 },
  { credits: 5000, price: 250, bonus: 250 },
  { credits: 10000, price: 500, bonus: 1000 },
  { credits: 15000, price: 750, bonus: 2250 },
];

function findPackage(credits) {
  return CREDIT_PACKAGES.find((p) => p.credits === Number(credits));
}

module.exports = { CREDIT_PACKAGES, findPackage };
