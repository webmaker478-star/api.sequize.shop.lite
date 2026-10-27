"use strict";

const { getOrCreateReferralProfile } = require("../../lib/referral");

const {
  sendJson,
  allowCors,
  readBody,
  requireServiceSecret
} = require("../../lib/referral-api");

const SHOPPY_ORIGIN =
  "https://shopingweb-zeta.vercel.app";

module.exports = async function handler(req, res) {
  if (allowCors(req, res)) {
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");

    return sendJson(res, 405, {
      success: false,
      message: "Method not allowed."
    });
  }

  // Only the trusted Shoppy server may call this endpoint.
  // The secret is never sent by the browser.
  if (!requireServiceSecret(req)) {
    return sendJson(res, 401, {
      success: false,
      message: "Unauthorized referral service request."
    });
  }

  try {
    const body = await readBody(req);

    // Support both field names so the existing Shoppy proxy
    // can send either "uid" or "userId".
    const rawUid =
      body && typeof body.uid === "string"
        ? body.uid
        : body && typeof body.userId === "string"
          ? body.userId
          : "";

    const uid = rawUid.trim();

    if (!uid || uid.length > 128) {
      return sendJson(res, 400, {
        success: false,
        message: "A valid authenticated user ID is required."
      });
    }

    // Create or retrieve this user's existing referral profile.
    const profile = await getOrCreateReferralProfile(uid);

    if (!profile || typeof profile !== "object") {
      return sendJson(res, 500, {
        success: false,
        message:
          "Could not create or retrieve the referral profile."
      });
    }

    const referralLink =
      typeof profile.referralLink === "string"
        ? profile.referralLink
        : "";

    const referralCode =
      typeof profile.referralCode === "string"
        ? profile.referralCode
        : "";

    const invitationId =
      typeof profile.invitationId === "string"
        ? profile.invitationId
        : "";

    let parsedLink = null;

    try {
      parsedLink = new URL(referralLink);
    } catch {
      parsedLink = null;
    }

    // Do not return an incomplete or unexpected referral link.
    if (
      !parsedLink ||
      parsedLink.protocol !== "https:" ||
      parsedLink.origin !== SHOPPY_ORIGIN ||
      !referralCode ||
      !invitationId
    ) {
      console.error(
        "Referral profile returned invalid link or identifiers."
      );

      return sendJson(res, 500, {
        success: false,
        message:
          "The referral profile is incomplete. Please try again."
      });
    }

    return sendJson(res, 200, {
      success: true,

      profile: {
        referralLink,
        referralCode,
        invitationId,
        createdAt: Number(profile.createdAt) || null
      }
    });
  } catch (error) {
    console.error(
      "Referral profile API error:",
      error && error.message ? error.message : error
    );

    return sendJson(res, 500, {
      success: false,
      message:
        "Could not generate your referral link. Please try again."
    });
  }
};
