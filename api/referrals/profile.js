"use strict";

const { getOrCreateReferralProfile } = require("../../lib/referral");
const { sendJson, allowCors, readBody, requireServiceSecret } = require("../../lib/referral-api");

module.exports = async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { success: false, error: "METHOD_NOT_ALLOWED" });
  if (!requireServiceSecret(req)) return sendJson(res, 401, { success: false, error: "UNAUTHORIZED" });

  try {
    const body = readBody(req);
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const result = await getOrCreateReferralProfile(userId);
    return sendJson(res, 200, result);
  } catch (error) {
    console.error("Referral profile error:", error.message);
    return sendJson(res, 500, { success: false, error: "REFERRAL_PROFILE_FAILED" });
  }
};
