require("dotenv/config");

const express = require("express");
const morgan = require("morgan");
const cors = require("cors");
const helmet = require("helmet");

const mongoose = require("mongoose");
const rateLimiters = require("./src/middleware/rateLimiters");

const app = express();

const port = process.env.PORT || 4000;

app.use(helmet());

// CORS_ORIGIN, comma-separated (e.g. "https://linkdexing.com,https://admin.linkdexing.com").
// Falls back to allowing any origin, matching the previous behaviour, if unset.
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.warn(
    "CORS_ORIGIN is not set — allowing all origins. Set it before deploying to production."
  );
}

app.use(
  cors(
    allowedOrigins.length > 0
      ? {
          origin: (origin, callback) => {
            // No Origin header (server-to-server, curl, mobile apps) is allowed.
            if (!origin || allowedOrigins.includes(origin)) {
              return callback(null, true);
            }
            return callback(new Error("Not allowed by CORS"));
          },
        }
      : undefined
  )
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));

app.use(morgan("dev"));

app.use("/api/", rateLimiters.general);

app.use("/api/v1/users", require("./src/api/v1/users/routes"));
app.use("/api/v1/orders", require("./src/api/v1/orders/routes"));
app.use("/api/v1/admin", require("./src/api/v1/admin/routes"));
app.use("/api/v1/payments", require("./src/api/v1/payments/routes"));

app.use((err, req, res, next) => {
  if (res.statusCode === 200) {
    res.status(err.statusCode || 500);
  }
  return res.json({
    ok: false,
    message: err.message,
  });
});

mongoose.connect(
  process.env.MONGODB_URI,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
  },
  (err) => {
    if (err) {
      console.log(err);
    } else {
      console.log("DB Connected");
    }
  }
);

app.listen(port, () => {
  console.log(`Listening at port ${port}`);
});
