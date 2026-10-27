"use strict";

function sendJson(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(payload));
}

function allowCors(req, res) {
  const origin = req.headers.origin;
  const allowed = "https://shopingweb-zeta.vercel.app";
  if (origin === allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function requireServiceSecret(req) {
  const expected = process.env.REFERRAL_SERVICE_SECRET;
  const header = req.headers.authorization || "";
  if (!expected || Buffer.byteLength(expected, "utf8") < 32) return false;
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const crypto = require("crypto");
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { sendJson, allowCors, readBody, requireServiceSecret };
