
const admin = require("firebase-admin");

function getFirebaseAdmin() {
  if (admin.apps.length) {
    return admin;
  }

  const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!serviceAccountText) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured");
  }

  if (!databaseURL) {
    throw new Error("FIREBASE_DATABASE_URL is not configured");
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(serviceAccountText);
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT must contain valid JSON"
    );
  }

  if (
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    throw new Error(
      "Firebase service account credentials are incomplete"
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL
  });

  return admin;
}

function getDatabase() {
  return getFirebaseAdmin().database();
}

module.exports = {
  getFirebaseAdmin,
  getDatabase
};
