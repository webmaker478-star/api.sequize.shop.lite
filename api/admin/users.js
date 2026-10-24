const { db } = require("../../lib/firebase");

const crypto = require("crypto");

function verifyAdmin(req, res) {
  const adminApiKey = process.env.ADMIN_API_KEY;

  if (!adminApiKey) {
    res.status(500).json({
      success: false,
      message: "Admin API is not configured."
    });

    return false;
  }

  const authorization = req.headers.authorization || "";

  console.log("ADMIN_API_KEY configured:", !!adminApiKey);
console.log(
  "Authorization header received:",
  !!req.headers.authorization
);
  if (!authorization.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      message: "Unauthorized access."
    });

    return false;
  }

  const suppliedKey = authorization.slice(7);

  const expectedBuffer = Buffer.from(adminApiKey);
  const suppliedBuffer = Buffer.from(suppliedKey);

  if (expectedBuffer.length !== suppliedBuffer.length) {
    res.status(401).json({
      success: false,
      message: "Unauthorized access."
    });

    return false;
  }

  if (
    !crypto.timingSafeEqual(
      expectedBuffer,
      suppliedBuffer
    )
  ) {
    res.status(401).json({
      success: false,
      message: "Unauthorized access."
    });

    return false;
  }

  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      success: false,
      message: "Method not allowed."
    });
  }

  if (!verifyAdmin(req, res)) {
    return;
  }

  try {
    /*
     * Fetch website users and Appnetick app users.
     */
    const [websiteSnapshot, appSnapshot] = await Promise.all([
      db.ref("users").get(),
      db.ref("Users").get()
    ]);

    const websiteUsers = [];
    const appUsers = [];

    /*
     * Website users
     * Root: users/{uid}
     */
    if (websiteSnapshot.exists()) {
      const data = websiteSnapshot.val();

      Object.entries(data).forEach(([uid, value]) => {
        const user = value || {};

        websiteUsers.push({
          uid: user.uid || uid,
          source: "website",
          name: user.name || "",
          email: user.email || "",
          createdAt: user.createdAt || "",
          status: user.status || "unknown"
        });
      });
    }

    /*
     * Android Appnetick users
     * Root: Users/{uid}
     */
    if (appSnapshot.exists()) {
      const data = appSnapshot.val();

      Object.entries(data).forEach(([uid, value]) => {
        const user = value || {};

        appUsers.push({
          uid: uid,
          source: "android_app",
          username: user.Username || "",
          full_name: user.full_name || "",
          email: user.email || "",
          avatar: user.avatar || "",
          verified:
            user.verified === true ||
            user.verify === true,
          private_profile:
            user.private_profile === true
        });
      });
    }

    const users = [...websiteUsers, ...appUsers];

    return res.status(200).json({
      success: true,
      total: users.length,
      websiteUsers: websiteUsers.length,
      appUsers: appUsers.length,
      users: users
    });

  } catch (error) {
    console.error(
      "Admin users API error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message: "Unable to fetch users."
    });
  }
};
