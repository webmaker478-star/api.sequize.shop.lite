const { db } = require("../lib/firebase");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  try {
    // Test Firebase Realtime Database connection.
    const snapshot = await db.ref(".info/connected").get();

    return res.status(200).json({
      success: true,
      service: "Appnetick Admin Backend",
      status: "running",
      firebase: "connected",
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Health check error:", error.message);

    return res.status(503).json({
      success: false,
      service: "Appnetick Admin Backend",
      status: "running",
      firebase: "error",
      message: "Unable to verify Firebase connection."
    });
  }
};
