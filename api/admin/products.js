// api/admin/products.js
// Admin API: list, add, update and remove products in Firebase Realtime Database.
// Products are stored at products/{40-char id}, the same path api/product.js reads.
//
// Environment variables (Vercel):
//   ADMIN_API_KEY             -> same key used by the admin panel
//   FIREBASE_SERVICE_ACCOUNT  -> service account JSON (same as api/product.js)

const admin = require("firebase-admin");
const crypto = require("crypto");

const DATABASE_URL =
  "https://shoppy-c289d-default-rtdb.asia-southeast1.firebasedatabase.app";

const ID_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9]{40}$/;

/* ---------------- Firebase ---------------- */

function initializeFirebase() {
  if (admin.apps.length) return admin.database();

  const value = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!value) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is missing.");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(value);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT must contain valid JSON.");
  }

  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
  });

  return admin.database();
}

/* ---------------- Helpers ---------------- */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function isAuthorized(req) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) throw new HttpError(500, "ADMIN_API_KEY is not configured on the server.");

  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function generateProductId() {
  const bytes = crypto.randomBytes(40);
  let id = "";
  for (let i = 0; i < 40; i++) id += ID_CHARS[bytes[i] % ID_CHARS.length];
  return id;
}

function str(value, max, label, required = false) {
  const s = value == null ? "" : String(value).trim();
  if (required && !s) throw new HttpError(400, label + " is required.");
  if (s.length > max) throw new HttpError(400, label + " is too long (max " + max + ").");
  return s;
}

function num(value, label, { min = 0, max = Infinity, integer = false, fallback = 0 } = {}) {
  if (value === "" || value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new HttpError(400, label + " is invalid.");
  }
  return n;
}

function list(value, max, itemMax, label) {
  let arr = value;
  if (typeof arr === "string") arr = arr.split(/[\n,]+/);
  if (!Array.isArray(arr)) return [];
  const out = arr.map(x => String(x == null ? "" : x).trim()).filter(Boolean);
  if (out.length > max) throw new HttpError(400, "Too many items in " + label + ".");
  out.forEach(x => {
    if (x.length > itemMax) throw new HttpError(400, label + " contains a value that is too long.");
  });
  return out;
}

function urlOrEmpty(value, label) {
  const s = str(value, 2000, label);
  if (s && !/^https?:\/\//i.test(s)) throw new HttpError(400, label + " must start with http:// or https://");
  return s;
}

/* Validate and normalise every product field used by api/product.js */
function cleanProduct(input) {
  if (!input || typeof input !== "object") throw new HttpError(400, "Product data is missing.");

  const sourceId = String(input.sourceId == null ? "" : input.sourceId).trim();
  if (!/^\d+$/.test(sourceId)) {
    throw new HttpError(400, "Source ID must be a number (DummyJSON product ID).");
  }

  const images = list(input.images, 30, 2000, "Images");
  images.forEach(u => urlOrEmpty(u, "Image URL"));

  let thumbnail = urlOrEmpty(input.thumbnail || input.image, "Thumbnail");

  let dimensions = null;
  if (input.dimensions && typeof input.dimensions === "object") {
    const w = input.dimensions.width, h = input.dimensions.height, d = input.dimensions.depth;
    if ([w, h, d].some(v => v !== "" && v != null)) {
      dimensions = {
        width: num(w, "Width"),
        height: num(h, "Height"),
        depth: num(d, "Depth")
      };
    }
  }

  let reviews = [];
  if (Array.isArray(input.reviews)) {
    if (input.reviews.length > 100) throw new HttpError(400, "Too many reviews.");
    reviews = input.reviews
      .filter(r => r && typeof r === "object")
      .map(r => ({
        rating: num(r.rating, "Review rating", { min: 0, max: 5 }),
        comment: str(r.comment, 1000, "Review comment"),
        date: str(r.date, 40, "Review date"),
        reviewerName: str(r.reviewerName, 100, "Reviewer name") || "Customer",
        reviewerEmail: str(r.reviewerEmail, 254, "Reviewer email")
      }));
  }

  return {
    sourceId,
    title: str(input.title, 200, "Title", true),
    description: str(input.description, 5000, "Description"),
    category: str(input.category, 100, "Category"),
    brand: str(input.brand, 100, "Brand"),
    price: num(input.price, "Price", { min: 0, max: 1e9 }),            // INR
    originalPriceUSD: num(input.originalPriceUSD, "Original price (USD)", { min: 0, max: 1e9 }),
    rating: num(input.rating, "Rating", { min: 0, max: 5 }),
    stock: num(input.stock, "Stock", { min: 0, max: 1e9, integer: true }),
    availabilityStatus: str(input.availabilityStatus, 60, "Availability status"),
    thumbnail,
    images,
    tags: list(input.tags, 50, 60, "Tags"),
    sku: str(input.sku, 100, "SKU"),
    weight: input.weight === "" || input.weight == null ? null : num(input.weight, "Weight"),
    dimensions,
    warrantyInformation: str(input.warrantyInformation, 300, "Warranty information"),
    shippingInformation: str(input.shippingInformation, 300, "Shipping information"),
    returnPolicy: str(input.returnPolicy, 300, "Return policy"),
    minimumOrderQuantity: num(input.minimumOrderQuantity, "Minimum order quantity", {
      min: 1, max: 1e6, integer: true, fallback: 1
    }),
    reviews
  };
}

/* Firebase rejects undefined and drops null, so null removes the key */
function forFirebase(obj) {
  const out = {};
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    out[k] = v === undefined ? null : (Array.isArray(v) && !v.length ? null : v);
  });
  return out;
}

async function listProducts(db) {
  const snap = await db.ref("products").once("value");
  const raw = snap.val() || {};
  return Object.keys(raw)
    .filter(id => raw[id] && typeof raw[id] === "object")
    .map(id => ({ ...raw[id], id }))
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

/* ---------------- Handler ---------------- */

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!isAuthorized(req)) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const db = initializeFirebase();

    if (req.method === "GET") {
      return res.status(200).json({ success: true, products: await listProducts(db) });
    }

    if (req.method !== "PUT" && req.method !== "POST") {
      res.setHeader("Allow", "GET, PUT, POST, OPTIONS");
      return res.status(405).json({ success: false, message: "Method not allowed." });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || typeof body !== "object") {
      throw new HttpError(400, "Invalid request body.");
    }

    const action = String(body.action || "");

    if (action === "add") {
      const clean = cleanProduct(body);
      let id = generateProductId();
      while ((await db.ref("products").child(id).once("value")).exists()) {
        id = generateProductId();
      }
      const now = Date.now();
      await db.ref("products").child(id).set(
        forFirebase({ ...clean, createdAt: now, updatedAt: now })
      );
    } else if (action === "update") {
      const id = String(body.id || "");
      if (!PRODUCT_ID_PATTERN.test(id)) throw new HttpError(400, "A valid product ID is required.");
      const ref = db.ref("products").child(id);
      if (!(await ref.once("value")).exists()) throw new HttpError(404, "Product not found.");
      const clean = cleanProduct(body);
      await ref.update(forFirebase({ ...clean, updatedAt: Date.now() }));
    } else if (action === "remove") {
      const id = String(body.id || "");
      if (!PRODUCT_ID_PATTERN.test(id)) throw new HttpError(400, "A valid product ID is required.");
      await db.ref("products").child(id).remove();
    } else {
      throw new HttpError(400, "Unknown action. Use add, update or remove.");
    }

    return res.status(200).json({ success: true, products: await listProducts(db) });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Admin products API error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong." });
  }
};
