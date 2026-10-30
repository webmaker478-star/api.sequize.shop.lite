import crypto from "crypto";
import dns from "dns/promises";
import net from "net";

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
];

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

function getKey() {
  const secret = process.env.IMAGE_PROXY_SECRET;
  if (!secret) throw new Error("IMAGE_PROXY_SECRET is not set");
  return crypto.createHash("sha256").update(secret).digest();
}

function decodeImageUrl(token) {
  const buf = Buffer.from(token, "base64url");
  if (buf.length < 29) throw new Error("Bad token");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export async function GET(request, { params }) {
  try {
    const { filename } = await params;
    const token = filename.replace(/\.(jpg|jpeg|png|webp|avif|gif)$/i, "");

    let source;
    try {
      source = decodeImageUrl(token);
    } catch {
      return new Response("Invalid token", { status: 400 });
    }

    const imageUrl = new URL(source);

    if (imageUrl.protocol !== "https:") {
      return new Response("Only https allowed", { status: 403 });
    }

    // SSRF protection: private/internal IPs blocked
    const addresses = await dns.lookup(imageUrl.hostname, { all: true });
    if (addresses.some((x) => isPrivateIp(x.address))) {
      return new Response("Host not allowed", { status: 403 });
    }

    const response = await fetch(imageUrl.href, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "error",
      cache: "force-cache",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error("Image fetch failed:", response.status);
      return new Response("Image not found", { status: response.status });
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase();

    if (!contentType || !ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return new Response("Invalid image type", { status: 415 });
    }

    const len = Number(response.headers.get("content-length") || 0);
    if (len > MAX_SIZE) {
      return new Response("Image too large", { status: 413 });
    }

    const image = await response.arrayBuffer();
    if (image.byteLength > MAX_SIZE) {
      return new Response("Image too large", { status: 413 });
    }

    return new Response(image, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Image proxy error:", error);
    return new Response("Failed to load image", { status: 500 });
  }
}
