const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const MAX_SIZE = 4 * 1024 * 1024; // Vercel function response limit is ~4.5MB

function getKey() {
  const secret = process.env.IMAGE_PROXY_SECRET;
  if (!secret) throw new Error("IMAGE_PROXY_SECRET is not set");
  return crypto.createHash("sha256").update(secret).digest();
}

function decodeImageUrl(token) {
  const buf = Buffer.from(token, "base64url");
  if (buf.length < 29) throw new Error("Bad token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

module.exports = async function handler(req, res) {
  try {
    const filename = String(req.query.filename || "");
    const token = filename.replace(/\.(jpg|jpeg|png|webp|avif|gif)$/i, "");

    let source;
    try {
      source = decodeImageUrl(token);
    } catch {
      return res.status(400).send("Invalid token");
    }

    const imageUrl = new URL(source);
    if (imageUrl.protocol !== "https:") return res.status(403).send("Only https allowed");

    const addresses = await dns.lookup(imageUrl.hostname, { all: true });
    if (addresses.some(x => isPrivateIp(x.address))) {
      return res.status(403).send("Host not allowed");
    }

    const response = await fetch(imageUrl.href, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return res.status(response.status).send("Image not found");

    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED.includes(type)) return res.status(415).send("Invalid image type");

    const image = Buffer.from(await response.arrayBuffer());
    if (image.length > MAX_SIZE) return res.status(413).send("Image too large");

    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(image);
  } catch (error) {
    console.error("Image proxy error:", error);
    return res.status(500).send("Failed to load image");
  }
};
