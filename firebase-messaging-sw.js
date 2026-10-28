importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyBeP1PetEM536IEXSJUTFCQ91oqo8n-fT0",
  authDomain: "shoppy-c289d.firebaseapp.com",
  databaseURL: "https://shoppy-c289d-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "shoppy-c289d",
  storageBucket: "shoppy-c289d.firebasestorage.app",
  messagingSenderId: "154536439593",
  appId: "1:154536439593:web:499b9de766bf6c06ce5138",
  measurementId: "G-FZ3QTFRRZM"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};

  const title = notification.title || "Shoppy";
  const options = {
    body: notification.body || "",
    icon: notification.icon || "/favicon.ico",
    data: {
      link: payload.fcmOptions?.link || "/"
    }
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const link = event.notification.data?.link || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (windowClients) => {
        for (const client of windowClients) {
          if ("focus" in client) {
            client.navigate(link);
            return client.focus();
          }
        }

        return clients.openWindow(link);
      }
    )
  );
});
