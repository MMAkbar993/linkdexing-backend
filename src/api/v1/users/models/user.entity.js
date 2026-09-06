const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      minLength: 4,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate:
        /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
    },
    password: {
      type: String,
      required: true,
      validate: /^.{5,}$/,
    },
    isRestrict: {
      type: Boolean,
      default: false,
    },
    totalLinks: {
      type: Number,
      default: 0,
    },
    // Cached running balance — the credit ledger (creditTransaction
    // collection) is the source of truth; this column exists so reads don't
    // have to aggregate the ledger every time. Kept in sync inside a single
    // transaction by src/services/credits.js.
    creditBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    forgotPasswordToken: {
      type: String,
    },
    otpSecret: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("user", userSchema);
