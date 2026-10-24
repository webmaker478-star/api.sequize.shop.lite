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
    // Read the Firebase database root.
    await db.ref("/").limitToFirst(1).get();

    return res.status(200).json({
      success: true,
      service: "Appnetick Admin Backend",
      status: "running",
      firebase: "connected",
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Firebase health check failed:", error);

    return res.status(503).json({
      success: false,
      service: "Appnetick Admin Backend",
      status: "running",
      firebase: "error",
      message: error.message || "Firebase connection failed."
    });
  }
};
