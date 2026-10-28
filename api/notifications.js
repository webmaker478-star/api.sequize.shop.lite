
const crypto = require("crypto");
const { getFirebaseAdmin, getDatabase } = require("../lib/firebase-admin");

const TOKEN_PATH = "fcmTokens";

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

function setCors(req, res) {
  // Public token registration does not require cookies.
  // Restrict allowed origins to your frontend domain in production.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));

  return (
    left.length === right.length &&
    crypto.timingSafeEqual(left, right)
  );
}

function requireAdmin(req) {
  const expected = process.env.FCM_ADMIN_API_KEY;
  const authorization = req.headers.authorization || "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  return Boolean(expected && supplied && safeEqual(supplied, expected));
}

function maskToken(token) {
  if (!token || token.length < 16) return "••••";
  return `${token.slice(0, 8)}…${token.slice(-6)}`;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return sendJson(res, 200, {
      status: "UP",
      service: "FCM Notifications API",
      actions: [
        "register-token",
        "list-tokens",
        "send-notification"
      ]
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendJson(res, 405, {
      success: false,
      error: "Method not allowed"
    });
  }

  const body = req.body || {};
  const action = String(body.action || "").trim();

  try {
    // Register a browser/device token.
    // This endpoint intentionally does not accept a claimed user ID:
    // identity must be verified before user-specific targeting is added.
    if (action === "register-token") {
      const token = String(body.fcmToken || "").trim();
      const platform = String(body.platform || "web").trim();

      if (!token || token.length > 8192 || /\s/.test(token)) {
        return sendJson(res, 400, {
          success: false,
          error: "A valid fcmToken is required"
        });
      }

      const tokenHash = hashToken(token);
      const db = getDatabase();
      const ref = db.ref(`${TOKEN_PATH}/${tokenHash}`);
      const snapshot = await ref.once("value");
      const previous = snapshot.val() || {};
      const now = Date.now();

      await ref.set({
        token,
        platform: ["web", "android", "ios"].includes(platform)
          ? platform
          : "web",
        enabled: true,
        createdAt: previous.createdAt || now,
        updatedAt: now
      });

      return sendJson(res, 200, {
        success: true,
        message: "FCM token registered",
        tokenId: tokenHash
      });
    }

    // All other actions require the backend-only admin key.
    // Never put this key in public frontend JavaScript or HTML.
    if (!requireAdmin(req)) {
      return sendJson(res, 401, {
        success: false,
        error: "Unauthorized"
      });
    }

    const db = getDatabase();
    const tokensRef = db.ref(TOKEN_PATH);

    if (action === "list-tokens") {
      const snapshot = await tokensRef.once("value");
      const records = snapshot.val() || {};

      const tokens = Object.entries(records)
        .filter(([, item]) => item && item.enabled && item.token)
        .map(([id, item]) => ({
          id,
          tokenPreview: maskToken(item.token),
          platform: item.platform || "web",
          createdAt: item.createdAt || null,
          updatedAt: item.updatedAt || null
        }));

      return sendJson(res, 200, {
        success: true,
        count: tokens.length,
        tokens
      });
    }

    if (action === "send-notification") {
      const title = String(body.title || "").trim();
      const messageBody = String(body.body || "").trim();
      const link = String(body.link || "").trim();

      if (!title || !messageBody) {
        return sendJson(res, 400, {
          success: false,
          error: "title and body are required"
        });
      }

      if (title.length > 150 || messageBody.length > 2000) {
        return sendJson(res, 400, {
          success: false,
          error: "Title or message is too long"
        });
      }

      if (link) {
        try {
          const parsed = new URL(link);
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            throw new Error("Invalid protocol");
          }
        } catch {
          return sendJson(res, 400, {
            success: false,
            error: "link must be a valid HTTP or HTTPS URL"
          });
        }
      }

      const snapshot = await tokensRef.once("value");
      const records = snapshot.val() || {};

      const targets = Object.entries(records).filter(
        ([, item]) => item && item.enabled && item.token
      );

      if (!targets.length) {
        return sendJson(res, 200, {
          success: true,
          message: "No registered devices found",
          total: 0,
          sent: 0,
          failed: 0
        });
      }

      const admin = getFirebaseAdmin();
      const messaging = admin.messaging();
      let sent = 0;
      let failed = 0;
      const invalidTokenIds = [];
      const failures = [];

      // FCM multicast requests accept up to 500 tokens per batch.
      for (let offset = 0; offset < targets.length; offset += 500) {
        const batch = targets.slice(offset, offset + 500);
        const registrationTokens = batch.map(([, item]) => item.token);

        const result = await messaging.sendEachForMulticast({
          tokens: registrationTokens,
          notification: {
            title,
            body: messageBody
          },
          ...(link
            ? {
                webpush: {
                  fcmOptions: { link }
                }
              }
            : {})
        });

        sent += result.successCount;
        failed += result.failureCount;

        result.responses.forEach((response, index) => {
          if (response.success) return;

          const [tokenId] = batch[index];
          const code = response.error && response.error.code
            ? response.error.code
            : "unknown";

          failures.push({ tokenId, code });

          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token"
          ) {
            invalidTokenIds.push(tokenId);
          }
        });
      }

      // Remove tokens that FCM confirms are no longer valid.
      if (invalidTokenIds.length) {
        const updates = {};
        for (const id of invalidTokenIds) {
          updates[`${TOKEN_PATH}/${id}`] = null;
        }
        await db.ref().update(updates);
      }

      return sendJson(res, 200, {
        success: true,
        message: "Notification send operation completed",
        total: targets.length,
        sent,
        failed,
        removedInvalidTokens: invalidTokenIds.length,
        failures: failures.slice(0, 50)
      });
    }

    return sendJson(res, 400, {
      success: false,
      error: "Unknown action"
    });
  } catch (error) {
    console.error("FCM API error:", error.message);

    return sendJson(res, 500, {
      success: false,
      error: "Notification API failed. Check server configuration and logs."
    });
  }
};
