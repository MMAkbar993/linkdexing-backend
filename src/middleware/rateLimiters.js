const rateLimit = require("express-rate-limit");

const make = (opts) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, message: "Too many requests, please try again later." },
    ...opts,
  });

// General guard on every /api/ route.
const general = make({ windowMs: 15 * 60 * 1000, max: 300 });

// Login endpoints (user + admin) — the classic brute-force target.
const login = make({ windowMs: 15 * 60 * 1000, max: 10 });

// OTP send/verify — guards against OTP brute-forcing and email-bombing via
// repeated resends.
const otp = make({ windowMs: 15 * 60 * 1000, max: 10 });

// Forgot-password — an open, unauthenticated endpoint that sends email and
// can be used to enumerate accounts.
const forgotPassword = make({ windowMs: 60 * 60 * 1000, max: 5 });

module.exports = { general, login, otp, forgotPassword };
