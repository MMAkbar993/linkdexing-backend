const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    userId: {
      required: true,
      type: mongoose.Types.ObjectId,
      ref: "user",
    },
    links: String,
    isProcessed: {
      type: Boolean,
      default: false,
    },
    dripfeed: {
      type: Number,
      required: true,
      max: 31,
      min: 1,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("order", orderSchema);
