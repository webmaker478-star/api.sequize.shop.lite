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
      throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured.");
    }

    const account = JSON.parse(raw);

    if (account.private_key) {
      account.private_key = account.private_key.replace(/\\n/g, "\n");
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
    id: String(tax.id || crypto.randomBytes(8).toString("hex")),
    title,
    percent: Number(percent.toFixed(2))
  };
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
    const ref = getDatabase().ref("shoppyCartTaxes");

    if (req.method === "GET") {
      const snapshot = await ref.once("value");
      const saved = snapshot.val();

      const taxes =
        Array.isArray(saved) && saved.length
          ? saved.map(cleanTax).filter(Boolean)
          : DEFAULT_TAXES;

      return res.status(200).json({
        success: true,
        taxes
      });
    }

    if (req.method !== "PUT") {
      res.setHeader("Allow", "GET, PUT, OPTIONS");

      return res.status(405).json({
        success: false,
        message: "Method not allowed."
      });
    }

    const expected = String(process.env.ADMIN_API_KEY || "");
    const authorization = String(req.headers.authorization || "");

    const provided = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    const authorized =
      expected.length > 0 &&
      provided.length === expected.length &&
      crypto.timingSafeEqual(
        Buffer.from(provided),
        Buffer.from(expected)
      );

    if (!authorized) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized."
      });
    }

    const body = typeof req.body === "string"
      ? JSON.parse(req.body)
      : (req.body || {});

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
        return res.status(400).json({
          success: false,
          message: "Enter a valid title and percentage from 0 to 100."
        });
      }

      if (taxes.some(item =>
        item.title.toLowerCase() === tax.title.toLowerCase()
      )) {
        return res.status(409).json({
          success: false,
          message: "A charge with this title already exists."
        });
      }

      taxes.push(tax);
    } else if (body.action === "remove") {
      taxes = taxes.filter(
        item => item.id !== String(body.id)
      );
    } else {
      return res.status(400).json({
        success: false,
        message: "Unsupported action."
      });
    }

    await ref.set(taxes);

    return res.status(200).json({
      success: true,
      taxes
    });
  } catch (error) {
    console.error("Cart taxes API error:", error);

    return res.status(500).json({
      success: false,
      message: "Could not load or update cart charges."
    });
  }
};
