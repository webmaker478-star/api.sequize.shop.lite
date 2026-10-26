const admin = require("firebase-admin");
const crypto = require("crypto");

const DATABASE_URL =
  "https://shoppy-c289d-default-rtdb.asia-southeast1.firebasedatabase.app";

const DEFAULT_TAXES = [
  { id: "shipping", title: "Shipping", percent: 2 },
  { id: "packaging", title: "Packaging", percent: 3 },
  { id: "platform-fee", title: "Platform fee", percent: 1 },
  { id: "delivery-charges", title: "Delivery charges", percent: 2 },
  { id: "gst", title: "GST", percent: 18 }
];

function getDatabase() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!raw) {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT is not configured."
      );
    }

    const account = JSON.parse(raw);

    if (account.private_key) {
      account.private_key = account.private_key.replace(
        /\\n/g,
        "\n"
      );
    }

    admin.initializeApp({
      credential: admin.credential.cert(account),
      databaseURL: DATABASE_URL
    });
  }

  return admin.database();
}

function cleanTax(tax) {
  const title = String(tax.title || "").trim().slice(0, 60);
  const percent = Number(tax.percent);

  if (
    !title ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100
  ) {
    return null;
  }

  return {
    id: String(
      tax.id || crypto.randomBytes(8).toString("hex")
    ),
    title,
    percent: Number(percent.toFixed(2))
  };
}

function send(res, status, data) {
  return res.status(status).json(data);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, PUT, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const database = getDatabase();
    const ref = database.ref("shoppyCartTaxes");

    // Customer aur admin panel ke liye charges load karein.
    if (req.method === "GET") {
      const snapshot = await ref.once("value");
      const saved = snapshot.val();

      const taxes =
        Array.isArray(saved) && saved.length
          ? saved.map(cleanTax).filter(Boolean)
          : DEFAULT_TAXES;

      return send(res, 200, {
        success: true,
        taxes
      });
    }

    if (req.method !== "PUT") {
      res.setHeader("Allow", "GET, PUT, OPTIONS");

      return send(res, 405, {
        success: false,
        message: "Method not allowed."
      });
    }

    // Admin API key verify karein.
    const expected = String(process.env.ADMIN_API_KEY || "");
    const authorization = String(
      req.headers.authorization || ""
    );

    const provided = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    const isAuthorized =
      expected.length > 0 &&
      provided.length === expected.length &&
      crypto.timingSafeEqual(
        Buffer.from(provided),
        Buffer.from(expected)
      );

    if (!isAuthorized) {
      return send(res, 401, {
        success: false,
        message: "Unauthorized. Use the configured admin API key."
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const snapshot = await ref.once("value");
    let taxes = snapshot.val();

    if (!Array.isArray(taxes) || !taxes.length) {
      taxes = DEFAULT_TAXES.map(tax => ({ ...tax }));
    }

    taxes = taxes.map(cleanTax).filter(Boolean);

    if (body.action === "add") {
      const tax = cleanTax({
        id: crypto.randomBytes(8).toString("hex"),
        title: body.title,
        percent: body.percent
      });

      if (!tax) {
        return send(res, 400, {
          success: false,
          message:
            "Enter a valid title and percentage from 0 to 100."
        });
      }

      const duplicate = taxes.some(
        item =>
          item.title.toLowerCase() === tax.title.toLowerCase()
      );

      if (duplicate) {
        return send(res, 409, {
          success: false,
          message: "A charge with this title already exists."
        });
      }

      taxes.push(tax);
    } else if (body.action === "remove") {
      taxes = taxes.filter(
        tax => tax.id !== String(body.id)
      );
    } else {
      return send(res, 400, {
        success: false,
        message: "Unsupported action."
      });
    }

    await ref.set(taxes);

    return send(res, 200, {
      success: true,
      taxes
    });
  } catch (error) {
    console.error("Cart taxes API error:", error);

    return send(res, 500, {
      success: false,
      message: "Could not load or update cart charges."
    });
  }
};
