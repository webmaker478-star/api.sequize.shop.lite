
"use strict";

const { getSession } = require("https://shopingweb-zeta.vercel.app/lib/auth.js");
const { getOrCreateReferralProfile } = require("../../lib/referral");
const { allowCors } = require("../../lib/referral-api");

module.exports = async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      success: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  try {
    // Verify the existing Shoppy login session.
    const session = getSession(req);

    if (!session || typeof session.uid !== "string" || !session.uid) {
      return sendJson(res, 401, {
        success: false,
        error: "UNAUTHORIZED",
        message: "Please sign in to your Shoppy account."
      });
    }

    // Use only the UID from the verified session.
    // Never trust a userId supplied by the browser.
    const result = await getOrCreateReferralProfile(session.uid);

    return sendJson(res, 200, {
      success: true,
      profile: result.profile || result
    });
  } catch (error) {
    console.error("Referral profile error:", error.message);

    return sendJson(res, 500, {
      success: false,
      error: "REFERRAL_PROFILE_FAILED"
    });
  }
};
