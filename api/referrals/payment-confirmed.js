"use strict";

const { creditReward } = require("../../lib/referral");
const { sendJson, allowCors, readBody, requireServiceSecret } = require("../../lib/referral-api");

module.exports = async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { success: false, error: "METHOD_NOT_ALLOWED" });
  if (!requireServiceSecret(req)) return sendJson(res, 401, { success: false, error: "UNAUTHORIZED" });

  try {
    const body = readBody(req);
    // This endpoint must only be called server-to-server after Cashfree verification.
    if (body.paymentStatus !== "PAID" || body.paymentVerified !== true) {
      return sendJson(res, 400, { success: false, error: "PAYMENT_NOT_VERIFIED" });
    }

    const result = await creditReward({
      orderId: String(body.orderId || ""),
      inviteeUid: String(body.inviteeUid || ""),
      inviterUid: String(body.inviterUid || ""),
      eligibleAmount: body.eligibleAmount,
      currency: body.currency || "INR"
    });

    return sendJson(res, 200, result);
  } catch (error) {
    console.error("Referral reward error:", error.message);
    return sendJson(res, 400, { success: false, error: error.message || "REWARD_FAILED" });
  }
};
