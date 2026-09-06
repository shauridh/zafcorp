/* Service worker portal customer — push notifikasi.
 * SENG A: tidak mencegat fetch agar dev (HMR) tetap mulus; cache dikelola Vite.
 * Handler: push → tampilkan notifikasi; notificationclick → buka portal. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let data = { title: 'Ayam SABANA', body: '' }
  try {
    if (e.data) data = { ...data, ...e.data.json() }
  } catch { /* payload non-JSON */ }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      vibrate: [120, 60, 120],
      data: { url: '/web-order.html' },
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/web-order.html'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus() }
      }
      return self.clients.openWindow(url)
    }),
  )
})