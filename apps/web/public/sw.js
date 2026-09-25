// Helena's service worker: shows the pushes Helena sends to this device and opens the page a
// notification points at (docs/helena-decisions/push.md). It does nothing else: no fetch
// handler, no cache, so the app loads exactly as it would without it.
//
// A push carries JSON (packages/push/src/payload.ts):
//   { v: 1, category, title, body, url, tag, renotify?, requireInteraction?, at }
// `url` is a path inside Helena. `tag` groups a problem with its recovery, so the recovery
// replaces the alarm on the lock screen instead of piling up next to it.
//
// The worker is registered as /sw.js?api=<the API's address> (features/push/services/
// pushBrowser.ts), so it can report a subscription the push service renewed.

const ICON = '/brand/icon-192.png';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function readPush(event) {
  if (!event.data) return null;
  try {
    const data = event.data.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return { title: 'Helena', body: event.data.text() };
  }
}

// Only a path inside Helena; anything else opens Start.
function samePath(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

self.addEventListener('push', (event) => {
  const data = readPush(event) ?? {};
  const title = typeof data.title === 'string' && data.title ? data.title : 'Helena';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: ICON,
    data: { url: samePath(data.url), category: data.category ?? null },
    lang: self.navigator?.language,
  };
  if (typeof data.tag === 'string' && data.tag) {
    options.tag = data.tag;
    options.renotify = data.renotify === true;
  }
  if (data.requireInteraction === true) options.requireInteraction = true;
  const at = typeof data.at === 'string' ? Date.parse(data.at) : NaN;
  if (Number.isFinite(at)) options.timestamp = at;
  // Every push shows a notification: a browser that sees a silent one revokes the
  // subscription (Safari) or shows a notice of its own (Chrome).
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = samePath(event.notification.data?.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        // Focus is only granted to a click on the notification itself; the page is shown
        // either way.
        await open.focus().catch(() => {});
        try {
          await open.navigate(target);
        } catch {
          // A tab this worker does not control yet: the page routes itself
          // (features/push/components/PushSync.tsx).
          open.postMessage({ type: 'helena-push-open', url: path });
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The push service replaced the subscription (Firefox does when it rotates keys): subscribe
// again with the same key and tell Helena, which moves the device's settings over. Needs the
// person's session cookie; without one the app does it the next time it opens.
self.addEventListener('pushsubscriptionchange', (event) => {
  const api = new URL(self.location.href).searchParams.get('api');
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription ?? null;
      const key = old?.options?.applicationServerKey ?? null;
      const renewed =
        event.newSubscription ??
        (key
          ? await self.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: key,
            })
          : null);
      if (!renewed || !api || !key) return;
      await fetch(`${api}/account/push/devices`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subscription: renewed.toJSON(),
          vapidKey: toBase64Url(key),
          ...(old?.endpoint ? { replaces: old.endpoint } : {}),
        }),
      }).catch(() => {});
    })(),
  );
});
