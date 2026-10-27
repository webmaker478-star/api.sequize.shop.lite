"use strict";

const crypto = require("crypto");
const { recordReferralVisit } = require("../../lib/referral");
const { sendJson, allowCors, readBody } = require("../../lib/referral-api");

module.exports = async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { success: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const body = readBody(req);
    const invitationId = typeof body.invitationId === "string" ? body.invitationId.trim() : "";
    let visitorId = typeof body.visitorId === "string" ? body.visitorId.trim() : "";

    if (!visitorId) visitorId = crypto.randomBytes(16).toString("hex");
    if (!/^[a-fA-F0-9]{16,80}$/.test(visitorId)) {
      return sendJson(res, 400, { success: false, error: "INVALID_VISITOR_ID" });
    }

    const result = await recordReferralVisit(invitationId, visitorId);
    if (!result.success) return sendJson(res, 400, result);
    return sendJson(res, 200, { success: true, recorded: result.recorded, visitorId });
  } catch (error) {
    console.error("Referral tracking error:", error.message);
    return sendJson(res, 500, { success: false, error: "TRACKING_FAILED" });
  }
};
