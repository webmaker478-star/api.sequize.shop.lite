"use strict";

const { db } = require("../../lib/firebase");
const { sendJson, allowCors, readBody, requireServiceSecret } = require("../../lib/referral-api");

module.exports = async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== "POST") return sendJson(res, 405, { success: false, error: "METHOD_NOT_ALLOWED" });
  if (!requireServiceSecret(req)) return sendJson(res, 401, { success: false, error: "UNAUTHORIZED" });

  try {
    const body = readBody(req);
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!userId || /[.#$[\]/]/.test(userId) || userId.length > 128) {
      return sendJson(res, 400, { success: false, error: "INVALID_USER_ID" });
    }

    const [profileSnap, inviteesSnap, rewardsSnap] = await Promise.all([
      db.ref(`ReferralProfiles/${userId}`).once("value"),
      db.ref("ReferralInvitees").orderByChild("inviterUid").equalTo(userId).once("value"),
      db.ref("ReferralRewards").orderByChild("inviterUid").equalTo(userId).once("value")
    ]);

    const profile = profileSnap.val();
    const invitees = inviteesSnap.val() || {};
    const rewards = rewardsSnap.val() || {};
    const earnedPaise = Object.values(rewards)
      .filter(r => r && r.status === "credited")
      .reduce((sum, r) => sum + Math.round(Number(r.rewardAmount || 0) * 100), 0);

    return sendJson(res, 200, {
      success: true,
      profile: profile || null,
      balance: earnedPaise / 100,
      referredUsers: Object.keys(invitees).length,
      totalEarned: earnedPaise / 100,
      currency: "INR"
    });
  } catch (error) {
    console.error("Referral summary error:", error.message);
    return sendJson(res, 500, { success: false, error: "REFERRAL_SUMMARY_FAILED" });
  }
};
