const crypto = require("crypto");
const { admin, getFirebaseAdmin, getDatabase } = require("../lib/firebase-admin");

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isAdmin(req) {
  const expected = process.env.FCM_ADMIN_API_KEY;
  const authorization = req.headers.authorization || "";

  if (!expected || !authorization.startsWith("Bearer ")) {
    return false;
  }

  const supplied = authorization.slice(7);

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);

  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return sendJson(res, 200, {
      status: "UP",
      service: "fcm-notifications",
      actions: ["register-token", "list-tokens", "send-notification"]
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const action = body.action;

    getFirebaseAdmin();
    const db = getDatabase();

    if (action === "register-token") {
      const token =
        typeof body.fcmToken === "string" ? body.fcmToken.trim() : "";

      if (!token || token.length > 8192) {
        return sendJson(res, 400, { error: "Valid fcmToken is required" });
      }

      const tokenId = hashToken(token);

      await db.ref("fcmTokens/" + tokenId).update({
        token,
        platform: body.platform === "web" ? "web" : "unknown",
        updatedAt: admin.database.ServerValue.TIMESTAMP
      });

      return sendJson(res, 200, {
        success: true,
        message: "FCM token registered"
      });
    }

    if (!isAdmin(req)) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    if (action === "list-tokens") {
      const snapshot = await db.ref("fcmTokens").once("value");
      const data = snapshot.val() || {};

      const tokens = Object.entries(data).map(([id, value]) => ({
        id,
        platform: value.platform || "unknown",
        updatedAt: value.updatedAt || null
      }));

      return sendJson(res, 200, {
        success: true,
        count: tokens.length,
        tokens
      });
    }

    if (action === "send-notification") {
      const title =
        typeof body.title === "string" ? body.title.trim() : "";
      const message =
        typeof body.body === "string" ? body.body.trim() : "";

      if (!title || !message) {
        return sendJson(res, 400, {
          error: "Both title and body are required"
        });
      }

      const snapshot = await db.ref("fcmTokens").once("value");
      const tokenRecords = snapshot.val() || {};

      const entries = Object.entries(tokenRecords).filter(
        ([, record]) => record && typeof record.token === "string" && record.token
      );

      if (entries.length === 0) {
        return sendJson(res, 200, {
          success: true,
          sent: 0,
          failed: 0,
          message: "No registered tokens"
        });
      }

      let sent = 0;
      let failed = 0;
      const invalidTokenIds = [];

      for (let i = 0; i < entries.length; i += 500) {
        const batch = entries.slice(i, i + 500);
        const tokens = batch.map(([, record]) => record.token);

        const result = await admin.messaging().sendEachForMulticast({
          tokens,
          notification: { title, body: message },
          webpush: {
            notification: {
              title,
              body: message,
              icon: body.icon || "/favicon.ico"
            },
            fcmOptions: body.link
              ? { link: body.link }
              : undefined
          }
        });

        sent += result.successCount;
        failed += result.failureCount;

        result.responses.forEach((response, index) => {
          if (!response.success) {
            const code = response.error && response.error.code;

            if (
              code === "messaging/invalid-registration-token" ||
              code === "messaging/registration-token-not-registered"
            ) {
              invalidTokenIds.push(batch[index][0]);
            }
          }
        });
      }

      if (invalidTokenIds.length) {
        const updates = {};
        invalidTokenIds.forEach((id) => {
          updates[id] = null;
        });

        await db.ref("fcmTokens").update(updates);
      }

      return sendJson(res, 200, {
        success: true,
        sent,
        failed,
        removedInvalidTokens: invalidTokenIds.length
      });
    }

    return sendJson(res, 400, {
      error: "Unknown action",
      supportedActions: [
        "register-token",
        "list-tokens",
        "send-notification"
      ]
    });
  } catch (error) {
    console.error("FCM notifications error:", error);

    return sendJson(res, 500, {
      error: "Notification request failed"
    });
  }
};
