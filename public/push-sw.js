self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_error) {
    data = {};
  }
  const title = data.title || '地震提醒';
  const options = {
    body: data.body || '收到新的地震信息。',
    icon: data.icon || '/app-icon.png',
    badge: data.icon || '/app-icon.png',
    tag: data.tag || 'quake-alert',
    renotify: true,
    silent: false,
    requireInteraction: data.requireInteraction === true,
    timestamp: Number.isFinite(Date.parse(data.timestamp)) ? Date.parse(data.timestamp) : Date.now(),
    data: {
      url: data.url || '/'
    }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('pushsubscriptionchange', event => {
  const oldEndpoint = event.oldSubscription && event.oldSubscription.endpoint || '';
  event.waitUntil(
    fetch('/push/public-key', { cache: 'no-store', credentials: 'same-origin' })
      .then(response => response.json())
      .then(data => {
        if (!data.supported || !data.publicKey) throw new Error('Push service is unavailable');
        return self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.publicKey)
        });
      })
      .then(subscription => fetch('/push/resubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          oldEndpoint,
          subscription: subscription.toJSON ? subscription.toJSON() : subscription
        })
      }))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin);
  const targetUrl = requestedUrl.origin === self.location.origin ? requestedUrl.href : `${self.location.origin}/`;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        for (const client of clients) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            if ('navigate' in client) return client.navigate(targetUrl).then(() => client.focus());
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = self.atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}
