const axios = require("axios");

const BASE_URL =
  process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

// Cached in memory — every request re-fetching a token would work too (PayPal
// doesn't rate-limit this tightly) but there's no reason to pay the round
// trip on every checkout click.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const { data } = await axios.post(
    `${BASE_URL}/v1/oauth2/token`,
    "grant_type=client_credentials",
    {
      auth: {
        username: process.env.PAYPAL_CLIENT_ID,
        password: process.env.PAYPAL_CLIENT_SECRET,
      },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  cachedToken = data.access_token;
  // Refresh a minute early so we never hand out a token that expires
  // mid-request.
  cachedTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

  return cachedToken;
}

async function authedRequest(method, path, body) {
  const token = await getAccessToken();
  const { data } = await axios({
    method,
    url: `${BASE_URL}${path}`,
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

// Creates a PayPal order for a fixed amount. Does not move money — the buyer
// still has to approve it, and capture() is a separate step.
function createOrder({ amount, currency = "USD", referenceId }) {
  return authedRequest("post", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: referenceId,
        amount: {
          currency_code: currency,
          value: Number(amount).toFixed(2),
        },
      },
    ],
  });
}

// Captures a previously-approved order. This is the step that actually moves
// money. Only succeeds if the buyer has approved the order in the PayPal UI.
function captureOrder(paypalOrderId) {
  return authedRequest(
    "post",
    `/v2/checkout/orders/${paypalOrderId}/capture`
  );
}

// Confirms a webhook event genuinely came from PayPal (not forged) by asking
// PayPal to re-verify it. Requires PAYPAL_WEBHOOK_ID, which only exists once
// a webhook is registered against a public HTTPS URL in the developer
// dashboard — so this can't be exercised from localhost.
async function verifyWebhookSignature(headers, body) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    return { configured: false, verified: false };
  }

  const result = await authedRequest(
    "post",
    "/v1/notifications/verify-webhook-signature",
    {
      transmission_id: headers["paypal-transmission-id"],
      transmission_time: headers["paypal-transmission-time"],
      cert_url: headers["paypal-cert-url"],
      auth_algo: headers["paypal-auth-algo"],
      transmission_sig: headers["paypal-transmission-sig"],
      webhook_id: webhookId,
      webhook_event: body,
    }
  );

  return {
    configured: true,
    verified: result.verification_status === "SUCCESS",
  };
}

module.exports = { createOrder, captureOrder, verifyWebhookSignature };
