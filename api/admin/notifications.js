const crypto = require("crypto");
const { db } = require("../../lib/firebase");

const CATEGORIES = [
  "orders",
  "payments",
  "shipping",
  "delivery",
  "returns",
  "refunds",
  "cancellations",
  "discounts",
  "promotions",
  "cart",
  "wishlist",
  "account",
  "security",
  "support",
  "system"
];

const MAX_LIMIT = 100;
const MAX_BROADCASTS_TO_READ = 2000;

function response(res, status, data) {
  return res.status(status).json(data);
}

function getAdminKey(req) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : "";
}

function isAuthorized(req) {
  const expected = process.env.ADMIN_API_KEY;
  const received = getAdminKey(req);

  if (!expected || !received) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedBuffer,
    receivedBuffer
  );
}

function cleanString(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function validCategory(category) {
  return CATEGORIES.includes(category);
}

function getLimit(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 1) {
    return 20;
  }

  return Math.min(Math.floor(number), MAX_LIMIT);
}

function makeNotificationId() {
  return (
    "N" +
    Date.now().toString(36) +
    crypto.randomBytes(8).toString("hex")
  );
}

function safeKey(value) {
  /*
   * Firebase path segments cannot contain these characters:
   * . # $ [ ] /
   */
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[.#$\[\]/]/.test(value)
  );
}

function validateUid(uid) {
  if (!uid) {
    throw new Error("Customer UID is required.");
  }

  if (!safeKey(uid)) {
    throw new Error("Invalid customer UID.");
  }

  return uid;
}

function validateNotificationId(id) {
  if (!id) {
    throw new Error("Notification ID is required.");
  }

  if (!safeKey(id)) {
    throw new Error("Invalid notification ID.");
  }

  return id;
}

function validateCategory(category) {
  if (!validCategory(category)) {
    throw new Error(
      "Invalid category. Allowed categories: " +
      CATEGORIES.join(", ")
    );
  }

  return category;
}

function getOptionalString(value, maxLength, fieldName) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (typeof value !== "string") {
    throw new Error(fieldName + " must be a string.");
  }

  return cleanString(value, maxLength);
}

function normalizeNotification(id, data, source) {
  return {
    id,
    title: data.title || "",
    message: data.message || "",
    category: validCategory(data.category)
      ? data.category
      : "general",
    type: data.type || "admin",
    read: data.read === true,
    createdAt: Number(data.createdAt) || 0,
    orderId: data.orderId || null,
    productId: data.productId || null,
    data: data.data || null,
    source
  };
}

async function getCustomer(uid) {
  /*
   * Website customer records use lowercase "users".
   * App customer records use uppercase "Users".
   */
  const websiteSnapshot = await db.ref("users/" + uid).get();

  if (websiteSnapshot.exists()) {
    return {
      uid,
      source: "website",
      data: websiteSnapshot.val()
    };
  }

  const appSnapshot = await db.ref("Users/" + uid).get();

  if (appSnapshot.exists()) {
    return {
      uid,
      source: "app",
      data: appSnapshot.val()
    };
  }

  return null;
}

function validateNotificationBody(body) {
  const title = cleanString(body.title, 150);
  const message = cleanString(body.message, 5000);

  const category = validateCategory(
    cleanString(body.category || "general", 40)
  );

  if (!title) {
    throw new Error("Notification title is required.");
  }

  if (!message) {
    throw new Error("Notification message is required.");
  }

  const orderId = getOptionalString(
    body.orderId,
    150,
    "orderId"
  );

  const productId = getOptionalString(
    body.productId,
    150,
    "productId"
  );

  if (orderId && !safeKey(orderId)) {
    throw new Error("Invalid orderId.");
  }

  if (productId && !safeKey(productId)) {
    throw new Error("Invalid productId.");
  }

  let extraData = null;

  if (body.data !== undefined && body.data !== null) {
    if (
      typeof body.data !== "object" ||
      Array.isArray(body.data)
    ) {
      throw new Error("data must be a JSON object.");
    }

    const serialized = JSON.stringify(body.data);

    if (serialized.length > 5000) {
      throw new Error("Notification data is too large.");
    }

    extraData = body.data;
  }

  return {
    title,
    message,
    category,
    orderId: orderId || null,
    productId: productId || null,
    data: extraData
  };
}

async function handleSend(body) {
  const uid = validateUid(
    cleanString(body.uid, 200)
  );

  const customer = await getCustomer(uid);

  if (!customer) {
    throw new Error("Customer not found.");
  }

  const input = validateNotificationBody(body);
  const notificationId = makeNotificationId();
  const createdAt = Date.now();

  const notification = {
    title: input.title,
    message: input.message,
    category: input.category,
    type: "admin",
    sender: "admin",
    read: false,
    createdAt
  };

  if (input.orderId) {
    notification.orderId = input.orderId;
  }

  if (input.productId) {
    notification.productId = input.productId;
  }

  if (input.data) {
    notification.data = input.data;
  }

  await db
    .ref("Notifications/" + uid + "/" + notificationId)
    .set(notification);

  return {
    uid,
    notificationId,
    notification,
    customerSource: customer.source,
    delivery: "saved"
  };
}

async function handleBroadcast(body) {
  const input = validateNotificationBody(body);
  const notificationId = makeNotificationId();

  const notification = {
    title: input.title,
    message: input.message,
    category: input.category,
    type: "broadcast",
    sender: "admin",
    createdAt: Date.now()
  };

  if (input.orderId) {
    notification.orderId = input.orderId;
  }

  if (input.productId) {
    notification.productId = input.productId;
  }

  if (input.data) {
    notification.data = input.data;
  }

  await db
    .ref("NotificationsBroadcast/" + notificationId)
    .set(notification);

  return {
    notificationId,
    notification,
    delivery: "saved",
    note:
      "Shared announcement saved. Customer clients must read " +
      "NotificationsBroadcast to display it."
  };
}

async function getNotificationData(uid) {
  const results = await Promise.all([
    db.ref("Notifications/" + uid).get(),
    db.ref("NotificationsBroadcast")
      .orderByChild("createdAt")
      .limitToLast(MAX_BROADCASTS_TO_READ)
      .get(),
    db.ref("NotificationReads/" + uid).get()
  ]);

  return {
    personalData: results[0].val() || {},
    broadcastData: results[1].val() || {},
    readData: results[2].val() || {}
  };
}

async function handleList(body) {
  const uid = validateUid(
    cleanString(body.uid, 200)
  );

  const customer = await getCustomer(uid);

  if (!customer) {
    throw new Error("Customer not found.");
  }

  const category = cleanString(body.category || "", 40);

  if (category) {
    validateCategory(category);
  }

  const limit = getLimit(body.limit);

  const {
    personalData,
    broadcastData,
    readData
  } = await getNotificationData(uid);

  const notifications = [];

  for (const id of Object.keys(personalData)) {
    const data = personalData[id];

    if (!data || typeof data !== "object") {
      continue;
    }

    if (category && data.category !== category) {
      continue;
    }

    notifications.push({
      ...normalizeNotification(id, data, "personal"),
      read:
        data.read === true ||
        readData[id] === true
    });
  }

  for (const id of Object.keys(broadcastData)) {
    const data = broadcastData[id];

    if (!data || typeof data !== "object") {
      continue;
    }

    if (category && data.category !== category) {
      continue;
    }

    notifications.push({
      ...normalizeNotification(id, data, "broadcast"),
      read: readData[id] === true
    });
  }

  notifications.sort(
    (a, b) => b.createdAt - a.createdAt
  );

  const total = notifications.length;

  const unread = notifications.filter(
    item => !item.read
  ).length;

  return {
    uid,
    total,
    unread,
    categories: CATEGORIES,
    notifications: notifications.slice(0, limit),
    broadcastLimit: MAX_BROADCASTS_TO_READ
  };
}

async function handleUnreadCount(body) {
  const uid = validateUid(
    cleanString(body.uid, 200)
  );

  const customer = await getCustomer(uid);

  if (!customer) {
    throw new Error("Customer not found.");
  }

  const {
    personalData,
    broadcastData,
    readData
  } = await getNotificationData(uid);

  const counts = {};

  for (const category of CATEGORIES) {
    counts[category] = 0;
  }

  let totalUnread = 0;

  function countNotification(id, data, isBroadcast) {
    if (!data || typeof data !== "object") {
      return;
    }

    const isRead = isBroadcast
      ? readData[id] === true
      : data.read === true || readData[id] === true;

    if (isRead) {
      return;
    }

    const category = validCategory(data.category)
      ? data.category
      : "general";

    counts[category]++;
    totalUnread++;
  }

  for (const id of Object.keys(personalData)) {
    countNotification(id, personalData[id], false);
  }

  for (const id of Object.keys(broadcastData)) {
    countNotification(id, broadcastData[id], true);
  }

  return {
    uid,
    totalUnread,
    categories: counts
  };
}

async function handleMarkRead(body) {
  const uid = validateUid(
    cleanString(body.uid, 200)
  );

  const notificationId = validateNotificationId(
    cleanString(body.notificationId, 200)
  );

  const customer = await getCustomer(uid);

  if (!customer) {
    throw new Error("Customer not found.");
  }

  const personalRef = db.ref(
    "Notifications/" + uid + "/" + notificationId
  );

  const personalSnapshot = await personalRef.get();

  if (personalSnapshot.exists()) {
    await personalRef.update({
      read: true
    });

    return {
      uid,
      notificationId,
      read: true,
      source: "personal"
    };
  }

  const broadcastSnapshot = await db
    .ref("NotificationsBroadcast/" + notificationId)
    .get();

  if (broadcastSnapshot.exists()) {
    await db
      .ref("NotificationReads/" + uid + "/" + notificationId)
      .set(true);

    return {
      uid,
      notificationId,
      read: true,
      source: "broadcast"
    };
  }

  throw new Error("Notification not found.");
}

async function handleMarkAllRead(body) {
  const uid = validateUid(
    cleanString(body.uid, 200)
  );

  const customer = await getCustomer(uid);

  if (!customer) {
    throw new Error("Customer not found.");
  }

  const {
    personalData,
    broadcastData
  } = await getNotificationData(uid);

  const updates = {};

  for (const id of Object.keys(personalData)) {
    const data = personalData[id];

    if (data && data.read !== true) {
      updates["Notifications/" + uid + "/" + id + "/read"] = true;
    }
  }

  for (const id of Object.keys(broadcastData)) {
    const data = broadcastData[id];

    if (data && data.createdAt) {
      updates["NotificationReads/" + uid + "/" + id] = true;
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.ref().update(updates);
  }

  return {
    uid,
    markedRead: Object.keys(updates).length
  };
}

async function handleDelete(body) {
  const uid = validateUid(
    cleanString(body.uid, 200)
  );

  const notificationId = validateNotificationId(
    cleanString(body.notificationId, 200)
  );

  const customer = await getCustomer(uid);

  if (!customer) {
    throw new Error("Customer not found.");
  }

  const personalRef = db.ref(
    "Notifications/" + uid + "/" + notificationId
  );

  const personalSnapshot = await personalRef.get();

  if (personalSnapshot.exists()) {
    await personalRef.remove();

    await db
      .ref("NotificationReads/" + uid + "/" + notificationId)
      .remove();

    return {
      uid,
      notificationId,
      deleted: true,
      source: "personal"
    };
  }

  /*
   * Do not delete shared broadcasts from this action.
   * Deleting one broadcast here would remove it for every customer.
   */
  const broadcastSnapshot = await db
    .ref("NotificationsBroadcast/" + notificationId)
    .get();

  if (broadcastSnapshot.exists()) {
    await db
      .ref("NotificationReads/" + uid + "/" + notificationId)
      .remove();

    return {
      uid,
      notificationId,
      deleted: true,
      source: "customer_read_state",
      note:
        "Only this customer's read-state entry was removed. " +
        "The shared broadcast remains available to other customers."
    };
  }

  throw new Error("Notification not found.");
}

function handleCategories() {
  return {
    categories: CATEGORIES
  };
}

function getStatusForError(message) {
  const clientErrors = [
    "Customer UID is required.",
    "Invalid customer UID.",
    "Invalid notification ID.",
    "Notification ID is required.",
    "Notification title is required.",
    "Notification message is required.",
    "Customer not found.",
    "Notification not found."
  ];

  if (
    clientErrors.includes(message) ||
    message.startsWith("Invalid category.") ||
    message.startsWith("orderId must") ||
    message.startsWith("productId must") ||
    message.startsWith("Invalid orderId") ||
    message.startsWith("Invalid productId") ||
    message.startsWith("data must") ||
    message.startsWith("Notification data is too large.")
  ) {
    return 400;
  }

  return 500;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Allow", "POST");

  if (req.method !== "POST") {
    return response(res, 405, {
      success: false,
      message: "Method not allowed. Use POST."
    });
  }

  if (!isAuthorized(req)) {
    return response(res, 401, {
      success: false,
      message: "Unauthorized access."
    });
  }

  try {
    const body = req.body || {};
    const action = cleanString(body.action, 40);

    let result;

    switch (action) {
      case "send":
        result = await handleSend(body);
        break;

      case "broadcast":
        result = await handleBroadcast(body);
        break;

      case "list":
        result = await handleList(body);
        break;

      case "unread_count":
        result = await handleUnreadCount(body);
        break;

      case "mark_read":
        result = await handleMarkRead(body);
        break;

      case "mark_all_read":
        result = await handleMarkAllRead(body);
        break;

      case "delete":
        result = await handleDelete(body);
        break;

      case "categories":
        result = handleCategories();
        break;

      default:
        return response(res, 400, {
          success: false,
          message: "Invalid action.",
          supportedActions: [
            "send",
            "broadcast",
            "list",
            "unread_count",
            "mark_read",
            "mark_all_read",
            "delete",
            "categories"
          ]
        });
    }

    return response(res, 200, {
      success: true,
      action,
      ...result
    });

  } catch (error) {
    console.error(
      "E-commerce notification API error:",
      error.message
    );

    return response(
      res,
      getStatusForError(error.message),
      {
        success: false,
        message: error.message || "Internal server error."
      }
    );
  }
};
