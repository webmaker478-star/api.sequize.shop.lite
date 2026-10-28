
const admin = require("firebase-admin");

let firebaseApp;

function getFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;

  if (admin.apps.length > 0) {
    firebaseApp = admin.app();
    return firebaseApp;
  }

  const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountText) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not configured");
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(serviceAccountText);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT must contain valid JSON");
  }

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });

  return firebaseApp;
}

function getDatabase() {
  getFirebaseAdmin();
  return admin.database();
}

module.exports = {
  admin,
  getFirebaseAdmin,
  getDatabase
};
