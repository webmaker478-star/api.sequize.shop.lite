"use strict";

const { assignInvitation } = require("../../lib/referral");
const { sendJson, allowCors, readBody, requireServiceSecret } = require("../../lib/referral-api");

module.exports = async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { success: false, error: "METHOD_NOT_ALLOWED" });
  if (!requireServiceSecret(req)) return sendJson(res, 401, { success: false, error: "UNAUTHORIZED" });

  try {
    const body = readBody(req);
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const invitationId = typeof body.invitationId === "string" ? body.invitationId.trim() : "";

    const result = await assignInvitation(userId, invitationId);
    if (!result.valid) return sendJson(res, 400, { success: false, error: result.reason });
    return sendJson(res, 200, { success: true, referral: result });
  } catch (error) {
    console.error("Referral validation error:", error.message);
    return sendJson(res, 500, { success: false, error: "REFERRAL_VALIDATION_FAILED" });
  }
};
