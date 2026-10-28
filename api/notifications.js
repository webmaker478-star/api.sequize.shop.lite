
const crypto = require("crypto");
const {
  admin,
  getFirebaseAdmin,
  getDatabase
} = require("../lib/firebase-admin");

const LOG_PREFIX = "[SHOPPY FCM]";

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

function logInfo(requestId, message, details = {}) {
  console.log(LOG_PREFIX, JSON.stringify({
    level: "INFO",
    requestId,
    message,
    ...details
  }));
}

function logError(requestId, message, error, details = {}) {
  console.error(LOG_PREFIX, JSON.stringify({
    level: "ERROR",
    requestId,
    message,
    errorCode: error && error.code ? error.code : null,
    errorMessage: error && error.message
      ? error.message
      : String(error || "Unknown error"),
    ...details
  }));
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

function getAdminAuthError(req) {
  const expected = process.env.FCM_ADMIN_API_KEY;
  const authorization = req.headers.authorization || "";

  if (!expected) {
    return "FCM_ADMIN_API_KEY is not configured on the server";
  }

  if (!authorization.startsWith("Bearer ")) {
    return "Missing Authorization: Bearer token";
  }

  if (!isAdmin(req)) {
    return "Invalid admin API key";
  }

  return null;
}

function safeErrorDetails(error) {
  return {
    code: error && error.code ? error.code : null,
    message: error && error.message
      ? error.message
      : "Unknown error"
  };
}

module.exports = async function handler(req, res) {
  const requestId = crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");

  const startedAt = Date.now();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("X-Request-Id", requestId);

  logInfo(requestId, "Request received", {
    method: req.method,
    url: req.url || null
  });

  if (req.method === "OPTIONS") {
    logInfo(requestId, "CORS preflight completed");

    return res.status(204).end();
  }

  if (req.method === "GET") {
    logInfo(requestId, "Health check successful");

    return sendJson(res, 200, {
      status: "UP",
      service: "fcm-notifications",
      requestId,
      actions: [
        "register-token",
        "list-tokens",
        "send-notification"
      ]
    });
  }

  if (req.method !== "POST") {
    logInfo(requestId, "Method not allowed", {
      method: req.method
    });

    res.setHeader("Allow", "GET, POST, OPTIONS");

    return sendJson(res, 405, {
      success: false,
      requestId,
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};
    const action = body.action;

    logInfo(requestId, "POST action received", {
      action: typeof action === "string" ? action : null,
      hasFcmToken: typeof body.fcmToken === "string",
      platform: body.platform || null
    });

    if (
      ![
        "register-token",
        "list-tokens",
        "send-notification"
      ].includes(action)
    ) {
      logInfo(requestId, "Unknown action", {
        action: typeof action === "string" ? action : null
      });

      return sendJson(res, 400, {
        success: false,
        requestId,
        error: "Unknown action",
        supportedActions: [
          "register-token",
          "list-tokens",
          "send-notification"
        ]
      });
    }

    // Initialize Firebase Admin.
    logInfo(requestId, "Initializing Firebase Admin");

    try {
      getFirebaseAdmin();
      logInfo(requestId, "Firebase Admin initialized");
    } catch (error) {
      logError(
        requestId,
        "Firebase Admin initialization failed",
        error
      );

      return sendJson(res, 500, {
        success: false,
        requestId,
        stage: "firebase-admin-init",
        error: "Firebase Admin initialization failed",
        details: safeErrorDetails(error)
      });
    }

    // Initialize/get Realtime Database.
    let db;

    try {
      logInfo(requestId, "Connecting to Firebase Realtime Database");

      db = getDatabase();

      logInfo(requestId, "Firebase Database instance obtained");
    } catch (error) {
      logError(
        requestId,
        "Firebase Database initialization failed",
        error
      );

      return sendJson(res, 500, {
        success: false,
        requestId,
        stage: "firebase-database-init",
        error: "Firebase Database initialization failed",
        details: safeErrorDetails(error)
      });
    }

    // Register an FCM token.
    if (action === "register-token") {
      const token =
        typeof body.fcmToken === "string"
          ? body.fcmToken.trim()
          : "";

      if (!token || token.length > 8192) {
        logInfo(requestId, "Token validation failed", {
          tokenProvided: Boolean(token),
          tokenLength: token.length
        });

        return sendJson(res, 400, {
          success: false,
          requestId,
          stage: "token-validation",
          error: "Valid fcmToken is required"
        });
      }

      const tokenId = hashToken(token);
      const databasePath = "fcmTokens/" + tokenId;

      logInfo(requestId, "Token validated; writing to database", {
        databasePath,
        tokenLength: token.length,
        platform: body.platform === "web" ? "web" : "unknown"
      });

      try {
        await db.ref(databasePath).update({
          token,
          platform: body.platform === "web" ? "web" : "unknown",
          updatedAt: admin.database.ServerValue.TIMESTAMP
        });

        logInfo(requestId, "FCM token saved successfully", {
          databasePath,
          durationMs: Date.now() - startedAt
        });

        return sendJson(res, 200, {
          success: true,
          requestId,
          stage: "token-saved",
          message: "FCM token registered"
        });
      } catch (error) {
        logError(
          requestId,
          "Failed to save FCM token to Realtime Database",
          error,
          { databasePath }
        );

        return sendJson(res, 500, {
          success: false,
          requestId,
          stage: "database-token-write",
          error: "Failed to save FCM token",
          details: safeErrorDetails(error)
        });
      }
    }

    // Admin authentication is required for the remaining actions.
    const authError = getAdminAuthError(req);

    if (authError) {
      logInfo(requestId, "Admin authentication failed", {
        reason: authError,
        action
      });

      return sendJson(res, 401, {
        success: false,
        requestId,
        stage: "admin-auth",
        error: authError
      });
    }

    logInfo(requestId, "Admin authentication successful", {
      action
    });

    // List registered tokens.
    if (action === "list-tokens") {
      logInfo(requestId, "Reading registered tokens");

      try {
        const snapshot = await db.ref("fcmTokens").once("value");
        const data = snapshot.val() || {};

        const tokens = Object.entries(data).map(([id, value]) => ({
          id,
          platform: value.platform || "unknown",
          updatedAt: value.updatedAt || null
        }));

        logInfo(requestId, "Token list retrieved", {
          count: tokens.length,
          durationMs: Date.now() - startedAt
        });

        return sendJson(res, 200, {
          success: true,
          requestId,
          count: tokens.length,
          tokens
        });
      } catch (error) {
        logError(requestId, "Failed to read registered tokens", error);

        return sendJson(res, 500, {
          success: false,
          requestId,
          stage: "database-list-tokens",
          error: "Failed to read registered tokens",
          details: safeErrorDetails(error)
        });
      }
    }

    // Send a notification to registered tokens.
    if (action === "send-notification") {
      const title =
        typeof body.title === "string" ? body.title.trim() : "";

      const message =
        typeof body.body === "string" ? body.body.trim() : "";

      if (!title || !message) {
        logInfo(requestId, "Notification input validation failed", {
          hasTitle: Boolean(title),
          hasBody: Boolean(message)
        });

        return sendJson(res, 400, {
          success: false,
          requestId,
          stage: "notification-validation",
          error: "Both title and body are required"
        });
      }

      let tokenRecords;

      try {
        logInfo(requestId, "Reading tokens for notification");

        const snapshot = await db.ref("fcmTokens").once("value");
        tokenRecords = snapshot.val() || {};
      } catch (error) {
        logError(
          requestId,
          "Failed to read tokens for notification",
          error
        );

        return sendJson(res, 500, {
          success: false,
          requestId,
          stage: "database-read-for-send",
          error: "Failed to read registered tokens",
          details: safeErrorDetails(error)
        });
      }

      const entries = Object.entries(tokenRecords).filter(
        ([, record]) =>
          record &&
          typeof record.token === "string" &&
          record.token
      );

      logInfo(requestId, "Notification recipients loaded", {
        recipientCount: entries.length
      });

      if (entries.length === 0) {
        return sendJson(res, 200, {
          success: true,
          requestId,
          sent: 0,
          failed: 0,
          message: "No registered tokens"
        });
      }

      let sent = 0;
      let failed = 0;

      const invalidTokenIds = [];
      const failureCodes = {};

      for (let i = 0; i < entries.length; i += 500) {
        const batch = entries.slice(i, i + 500);
        const tokens = batch.map(([, record]) => record.token);

        logInfo(requestId, "Sending notification batch", {
          batchStart: i,
          batchSize: batch.length
        });

        let result;

        try {
          result = await admin.messaging().sendEachForMulticast({
            tokens,
            notification: {
              title,
              body: message
            },
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
        } catch (error) {
          logError(
            requestId,
            "FCM multicast send failed",
            error,
            {
              batchStart: i,
              batchSize: batch.length
            }
          );

          return sendJson(res, 500, {
            success: false,
            requestId,
            stage: "fcm-send",
            error: "Failed to send notification batch",
            details: safeErrorDetails(error)
          });
        }

        sent += result.successCount;
        failed += result.failureCount;

        result.responses.forEach((response, index) => {
          if (response.success) {
            return;
          }

          const error = response.error || {};
          const code = error.code || "unknown";

          failureCodes[code] = (failureCodes[code] || 0) + 1;

          logError(
            requestId,
            "Notification delivery failed for a token",
            error,
            {
              tokenId: batch[index][0],
              errorCode: code
            }
          );

          if (
            code === "messaging/invalid-registration-token" ||
            code === "messaging/registration-token-not-registered"
          ) {
            invalidTokenIds.push(batch[index][0]);
          }
        });

        logInfo(requestId, "Notification batch completed", {
          batchSize: batch.length,
          successCount: result.successCount,
          failureCount: result.failureCount
        });
      }

      if (invalidTokenIds.length) {
        const updates = {};

        invalidTokenIds.forEach((id) => {
          updates[id] = null;
        });

        try {
          await db.ref("fcmTokens").update(updates);

          logInfo(requestId, "Invalid tokens removed", {
            removedCount: invalidTokenIds.length
          });
        } catch (error) {
          logError(
            requestId,
            "Failed to remove invalid tokens",
            error,
            { invalidTokenCount: invalidTokenIds.length }
          );
        }
      }

      logInfo(requestId, "Notification request completed", {
        sent,
        failed,
        removedInvalidTokens: invalidTokenIds.length,
        failureCodes,
        durationMs: Date.now() - startedAt
      });

      return sendJson(res, 200, {
        success: true,
        requestId,
        sent,
        failed,
        removedInvalidTokens: invalidTokenIds.length,
        failureCodes
      });
    }
  } catch (error) {
    logError(requestId, "Unhandled notification API error", error, {
      durationMs: Date.now() - startedAt
    });

    return sendJson(res, 500, {
      success: false,
      requestId,
      stage: "unhandled-error",
      error: "Notification request failed",
      details: safeErrorDetails(error)
    });
  }
};
