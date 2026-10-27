"use strict";

const crypto = require("crypto");
const {
  getOrCreateReferralProfile
} = require("../../lib/referral");

function sendJson(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");

  return res.status(status).json(data);
}

function verifyReferralToken(token) {
  const secret = process.env.REFERRAL_TOKEN_SECRET;

  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Referral token secret is not configured.");
  }

  if (typeof token !== "string" || token.length > 4096) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [encodedPayload, receivedSignature] = parts;

  if (!encodedPayload || !receivedSignature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  const receivedBuffer = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  let payload;

  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    !payload ||
    typeof payload.uid !== "string" ||
    !payload.uid ||
    payload.purpose !== "shoppy-referral" ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= now ||
    !Number.isInteger(payload.iat) ||
    payload.iat > now + 60
  ) {
    return null;
  }

  return payload;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendJson(res, 405, {
      success: false,
      message: "Method not allowed."
    });
  }

  try {
    const authorization = req.headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return sendJson(res, 401, {
        success: false,
        message: "Please sign in to your Shoppy account, then try again."
      });
    }

    const verified = verifyReferralToken(match[1]);

    if (!verified) {
      return sendJson(res, 401, {
        success: false,
        message: "Your login has expired. Please sign in again."
      });
    }

    const profile = await getOrCreateReferralProfile(verified.uid);

    if (!profile || !profile.referralCode || !profile.referralLink) {
      return sendJson(res, 500, {
        success: false,
        message: "Could not create your referral profile."
      });
    }

    return sendJson(res, 200, {
      success: true,
      profile
    });
  } catch (error) {
    console.error("Referral profile API error:", error);

    return sendJson(res, 500, {
      success: false,
      message: "Could not generate your referral link. Please try again."
    });
  }
};
