// Firebase Cloud Messaging Service Worker for YT Market
// Handles background push notifications when app is closed / in background

importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyByg84alOyd8njFHvwKtsjb1GYXaVW9CH8",
  authDomain: "final-1-43f3d.firebaseapp.com",
  databaseURL: "https://final-1-43f3d-default-rtdb.firebaseio.com",
  projectId: "final-1-43f3d",
  storageBucket: "final-1-43f3d.firebasestorage.app",
  messagingSenderId: "44009226017",
  appId: "1:44009226017:web:351390dad2794208984860"
};

try {
  firebase.initializeApp(firebaseConfig);
} catch (e) {
  // Already initialized
}

let messaging = null;
try {
  messaging = firebase.messaging();
} catch (e) {
  console.warn('[firebase-messaging-sw] messaging init error:', e);
}

// Immediate activation
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle FCM Background Messages
if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw] Received background message:', payload);
    const notificationTitle = payload.notification?.title || payload.data?.title || 'YT Market Notification';
    const notificationOptions = {
      body: payload.notification?.body || payload.data?.body || payload.data?.message || 'New update from YT Market',
      icon: payload.notification?.icon || payload.data?.icon || '/icon-192.png',
      badge: '/icon-192.png',
      image: payload.notification?.image || payload.data?.image || undefined,
      vibrate: [200, 100, 200, 100, 200],
      data: payload.data || {},
      tag: payload.data?.tag || 'yt-notif-' + Date.now(),
      renotify: true
    };

    return self.registration.showNotification(notificationTitle, notificationOptions);
  });
}

// Fallback Raw Push Event Listener (catches direct FCM / WebPush payloads)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    console.log('[firebase-messaging-sw] Raw push event JSON:', payload);

    // If FCM already displayed a notification, skip duplicate
    const title = payload.notification?.title || payload.data?.title || payload.title || 'YT Market Notification';
    const body = payload.notification?.body || payload.data?.body || payload.data?.message || payload.body || 'You have a new notification';
    const icon = payload.notification?.icon || payload.data?.icon || '/icon-192.png';
    const image = payload.notification?.image || payload.data?.image || undefined;

    const options = {
      body,
      icon,
      badge: icon,
      image,
      vibrate: [200, 100, 200, 100, 200],
      tag: 'yt-market-push-' + (payload.id || Date.now()),
      renotify: true,
      data: payload.data || payload
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    try {
      const text = event.data.text();
      console.log('[firebase-messaging-sw] Raw push event text:', text);
      event.waitUntil(
        self.registration.showNotification('YT Market Notification', {
          body: text || 'New notification received',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          vibrate: [200, 100, 200],
          tag: 'yt-market-text-' + Date.now()
        })
      );
    } catch (e) {}
  }
});

// Click action on phone: focus or open the app window
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
