const admin = require("firebase-admin");
const crypto = require("crypto");
const DATABASE_URL = "https://shoppy-c289d-default-rtdb.asia-southeast1.firebasedatabase.app";
function db() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured.");
    const account = JSON.parse(raw);
    if (account.private_key) account.private_key = account.private_key.replace(/\\n/g, "\n");
    admin.initializeApp({ credential: admin.credential.cert(account), databaseURL: DATABASE_URL });
  }
  return admin.database();
}
function cleanDiscount(d) {
  const title = String(d.title || "").trim().slice(0, 60);
  const percent = Number(d.percent);
  const scope = d.scope === "user" ? "user" : "all";
  const userEmail = String(d.userEmail || "").trim().toLowerCase().slice(0, 254);
  if (!title || !Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  if (scope === "user" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) return null;
  return { id: String(d.id || crypto.randomBytes(8).toString("hex")), title, percent: Number(percent.toFixed(2)), scope, userEmail: scope === "user" ? userEmail : "" };
}
function send(res, status, data) { return res.status(status).json(data); }
function authorized(req) {
  const expected = String(process.env.ADMIN_API_KEY || ""), auth = String(req.headers.authorization || ""), provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return !!expected && !!provided && provided.length === expected.length && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const ref = db().ref("shoppyCustomerDiscounts");
    if (req.method === "GET") {
      const snap = await ref.once("value"), saved = snap.val();
      const discounts = (Array.isArray(saved) ? saved : saved && typeof saved === "object" ? Object.values(saved) : []).map(cleanDiscount).filter(Boolean);
      if (authorized(req)) return send(res, 200, { success: true, discounts });
      const email = String(req.query && req.query.email || "").trim().toLowerCase();
      const eligible = discounts.filter(d => d.scope === "all" || (email && d.scope === "user" && d.userEmail === email));
      return send(res, 200, { success: true, discounts: eligible.map(({id,title,percent,scope}) => ({id,title,percent,scope})) });
    }
    if (req.method !== "PUT") { res.setHeader("Allow", "GET, PUT, OPTIONS"); return send(res, 405, { success: false, message: "Method not allowed." }); }
    if (!authorized(req)) return send(res, 401, { success: false, message: "Unauthorized. Use the configured admin API key." });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const snap = await ref.once("value"), saved = snap.val();
    let discounts = (Array.isArray(saved) ? saved : saved && typeof saved === "object" ? Object.values(saved) : []).map(cleanDiscount).filter(Boolean);
    if (body.action === "add") {
      const discount = cleanDiscount({ id: crypto.randomBytes(8).toString("hex"), title: body.title, percent: body.percent, scope: body.scope, userEmail: body.userEmail });
      if (!discount) return send(res, 400, { success: false, message: "Enter a title, valid discount percent (greater than 0 and up to 100), and a valid email for single-user offers." });
      if (discounts.some(d => d.title.toLowerCase() === discount.title.toLowerCase() && d.scope === discount.scope && d.userEmail === discount.userEmail)) return send(res, 409, { success: false, message: "A discount with this title and target already exists." });
      discounts.push(discount);
    } else if (body.action === "remove") {
      discounts = discounts.filter(d => d.id !== String(body.id));
    } else return send(res, 400, { success: false, message: "Unsupported action." });
    await ref.set(discounts);
    return send(res, 200, { success: true, discounts });
  } catch (error) {
    console.error("Customer discounts API error:", error);
    return send(res, 500, { success: false, message: "Could not load or update discounts." });
  }
};
