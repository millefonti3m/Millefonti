// Service Worker — Ambulatorio Millefonti
// Gestisce push notifications

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Ricevi push notification
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  const title = data.title || 'Ambulatorio Millefonti';
  const options = {
    body: data.body || 'Hai nuovi ECG da refertare',
    icon: '/logo-squared.png',
    badge: '/logo-squared.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'ecg-' + Date.now(),
    renotify: true,
    data: { url: data.url || '/' },
    actions: [{ action: 'apri', title: '🫀 Apri app' }],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Click sulla notifica → apri app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    })
  );
});
