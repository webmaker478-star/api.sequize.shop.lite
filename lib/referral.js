"use strict";

const crypto = require("crypto");
const { db } = require("./firebase");

const REFERRAL_CONFIG = Object.freeze({
  FRIEND_DISCOUNT_PERCENT: 40,
  INVITER_REWARD_PERCENT: 10,
  CURRENCY: "INR",
  MAX_REFERRAL_CODE_LENGTH: 32
});

function normalizeUid(uid) {
  return typeof uid === "string" ? uid.trim() : "";
}

function isValidId(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    !/[.#$[\]/]/.test(value);
}

function createReferralCode() {
  return crypto.randomBytes(12).toString("hex")
    .toUpperCase()
    .slice(0, REFERRAL_CONFIG.MAX_REFERRAL_CODE_LENGTH);
}

function createInvitationId() {
  return crypto.randomBytes(16).toString("hex");
}

function createReferralLink(userId, invitationId) {
  const uid = normalizeUid(userId);
  if (!isValidId(uid) || !isValidId(invitationId)) {
    throw new Error("Invalid referral link parameters.");
  }

  const url = new URL("https://shopingweb-zeta.vercel.app/invites/referrals/");
  url.searchParams.set("userId", uid);
  url.searchParams.set("invitationId", invitationId);
  return url.toString();
}

function isCompleteProfile(profile) {
  return Boolean(profile &&
    typeof profile.referralCode === "string" &&
    typeof profile.invitationId === "string" &&
    typeof profile.referralLink === "string");
}

async function getOrCreateReferralProfile(userId) {
  const uid = normalizeUid(userId);
  if (!isValidId(uid)) throw new Error("A valid user ID is required.");

  // lib/firebase.js exports an instance, not a function.
  const profileRef = db.ref(`ReferralProfiles/${uid}`);
  const existingSnapshot = await profileRef.once("value");
  const existing = existingSnapshot.val();

  if (isCompleteProfile(existing)) {
    return { success: true, profile: existing };
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const referralCode = createReferralCode();
    const invitationId = createInvitationId();
    const createdAt = Date.now();
    const profile = {
      uid,
      referralCode,
      invitationId,
      referralLink: createReferralLink(uid, invitationId),
      createdAt
    };

    const codeRef = db.ref(`ReferralCodes/${referralCode}`);
    const codeResult = await codeRef.transaction(current => {
      if (current === null) return { uid, invitationId, createdAt };
      return;
    }, undefined, false);

    if (!codeResult.committed) continue;

    try {
      const profileResult = await profileRef.transaction(current => {
        if (current === null) return profile;
        return;
      }, undefined, false);

      if (profileResult.committed) {
        return { success: true, profile: profileResult.snapshot.val() };
      }

      await codeRef.transaction(current => {
        if (current && current.uid === uid &&
            current.invitationId === invitationId) return null;
        return current;
      });

      const latest = (await profileRef.once("value")).val();
      if (isCompleteProfile(latest)) {
        return { success: true, profile: latest };
      }
    } catch (error) {
      await codeRef.transaction(current => {
        if (current && current.uid === uid &&
            current.invitationId === invitationId) return null;
        return current;
      });
      throw error;
    }
  }

  throw new Error("Unable to create a unique referral profile.");
}

async function validateInvitation(inviteeUid, invitationId) {
  const invitee = normalizeUid(inviteeUid);
  const inviteId = typeof invitationId === "string" ? invitationId.trim() : "";

  if (!isValidId(invitee) || !isValidId(inviteId)) {
    return { valid: false, reason: "INVALID_INVITATION" };
  }

  const snapshot = await db.ref("ReferralProfiles")
    .orderByChild("invitationId")
    .equalTo(inviteId)
    .limitToFirst(1)
    .once("value");

  const profiles = snapshot.val();
  if (!profiles || typeof profiles !== "object") {
    return { valid: false, reason: "INVITATION_NOT_FOUND" };
  }

  const inviterUid = Object.keys(profiles)[0];
  const profile = profiles[inviterUid];

  if (!profile || profile.invitationId !== inviteId) {
    return { valid: false, reason: "INVITATION_NOT_FOUND" };
  }

  if (inviterUid === invitee) {
    return { valid: false, reason: "SELF_REFERRAL" };
  }

  // An invitee may only be attributed once.
  const existingReferral = (await db.ref(`ReferralInvitees/${invitee}`).once("value")).val();
  if (existingReferral && existingReferral.inviterUid &&
      existingReferral.inviterUid !== inviterUid) {
    return { valid: false, reason: "REFERRAL_ALREADY_ASSIGNED" };
  }

  return {
    valid: true,
    inviterUid,
    inviteeUid: invitee,
    invitationId: inviteId,
    friendDiscountPercent: REFERRAL_CONFIG.FRIEND_DISCOUNT_PERCENT,
    inviterRewardPercent: REFERRAL_CONFIG.INVITER_REWARD_PERCENT
  };
}

async function assignInvitation(inviteeUid, invitationId) {
  const validation = await validateInvitation(inviteeUid, invitationId);
  if (!validation.valid) return validation;

  const ref = db.ref(`ReferralInvitees/${validation.inviteeUid}`);
  const result = await ref.transaction(current => {
    if (current === null) {
      return {
        inviteeUid: validation.inviteeUid,
        inviterUid: validation.inviterUid,
        invitationId: validation.invitationId,
        assignedAt: Date.now(),
        status: "assigned"
      };
    }
    if (current.inviterUid === validation.inviterUid &&
        current.invitationId === validation.invitationId) return current;
    return;
  }, undefined, false);

  if (!result.committed) {
    const current = (await ref.once("value")).val();
    if (current && current.inviterUid === validation.inviterUid &&
        current.invitationId === validation.invitationId) {
      return { ...validation, alreadyAssigned: true };
    }
    return { valid: false, reason: "REFERRAL_ALREADY_ASSIGNED" };
  }

  return { ...validation, alreadyAssigned: false };
}

async function recordReferralVisit(invitationId, visitorId) {
  const inviteId = typeof invitationId === "string" ? invitationId.trim() : "";
  const visitor = typeof visitorId === "string" ? visitorId.trim() : "";
  if (!isValidId(inviteId) || !/^[a-zA-Z0-9_-]{8,80}$/.test(visitor)) {
    return { success: false, reason: "INVALID_PARAMETERS" };
  }

  const snapshot = await db.ref("ReferralProfiles")
    .orderByChild("invitationId")
    .equalTo(inviteId)
    .limitToFirst(1)
    .once("value");
  const profiles = snapshot.val();
  if (!profiles || typeof profiles !== "object") {
    return { success: false, reason: "INVITATION_NOT_FOUND" };
  }

  const inviterUid = Object.keys(profiles)[0];
  const visitRef = db.ref(`ReferralVisits/${inviteId}/${visitor}`);
  const result = await visitRef.transaction(current => current || {
    inviterUid,
    invitationId: inviteId,
    visitorId: visitor,
    firstVisitedAt: Date.now()
  }, undefined, false);

  return { success: true, recorded: result.committed };
}

async function creditReward({ orderId, inviteeUid, inviterUid, eligibleAmount, currency }) {
  if (!isValidId(orderId) || !isValidId(inviteeUid) ||
      !isValidId(inviterUid) || inviterUid === inviteeUid) {
    throw new Error("Invalid paid-order referral data.");
  }

  const amount = Number(eligibleAmount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    throw new Error("Invalid eligible order amount.");
  }

  const curr = String(currency || "INR").toUpperCase();
  if (curr !== "INR") throw new Error("Unsupported reward currency.");

  const assigned = (await db.ref(`ReferralInvitees/${inviteeUid}`).once("value")).val();
  if (!assigned || assigned.inviterUid !== inviterUid) {
    throw new Error("Order referral does not match the assigned referral.");
  }

  const rewardPaise = Math.round(amount * 100 *
    REFERRAL_CONFIG.INVITER_REWARD_PERCENT / 100);
  const rewardId = crypto.createHash("sha256")
    .update(`${orderId}:${inviteeUid}:${inviterUid}`)
    .digest("hex");

  const rewardRef = db.ref(`ReferralRewards/${rewardId}`);
  const rewardRecord = {
    rewardId,
    orderId,
    inviteeUid,
    inviterUid,
    eligibleAmount: Math.round(amount * 100) / 100,
    rewardAmount: rewardPaise / 100,
    currency: curr,
    rewardPercent: REFERRAL_CONFIG.INVITER_REWARD_PERCENT,
    status: "credited",
    createdAt: Date.now()
  };

  const result = await rewardRef.transaction(current => {
    if (current === null) return rewardRecord;
    return;
  }, undefined, false);

  if (!result.committed) {
    return { success: true, duplicate: true, reward: result.snapshot.val() };
  }

  // ReferralRewards is the immutable reward ledger and the source of truth.
  // Derive the balance from this ledger rather than incrementing a separate
  // balance counter, so retries/crashes cannot double-credit or lose balance.
  await db.ref(`ReferralInvitees/${inviteeUid}`).update({
    status: "rewarded",
    rewardedOrderId: orderId,
    rewardedAt: Date.now()
  });

  return { success: true, duplicate: false, reward: rewardRecord };
}

module.exports = {
  REFERRAL_CONFIG,
  createReferralCode,
  createInvitationId,
  createReferralLink,
  getOrCreateReferralProfile,
  validateInvitation,
  assignInvitation,
  recordReferralVisit,
  creditReward
};
