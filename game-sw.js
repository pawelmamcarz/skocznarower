/* Service worker gry Skoczna Rider (/gra, /en/gra, /ua/gra).
   Obsługuje wyłącznie zasoby gry, żeby reszta serwisu i API zostały nietknięte:
   nawigacje do stron gry idą network-first z fallbackiem do cache (tryb offline),
   statyki gry stale-while-revalidate. Każde inne żądanie przechodzi do sieci
   bez respondWith, więc /api, /admin i strony serwisu działają jak dotąd. */
const CACHE = 'skoczna-rider-v3';

const PAGES = ['/gra', '/en/gra', '/ua/gra'];
const STATIC = [
  '/game.js',
  '/gra.webmanifest',
  '/en/gra.webmanifest',
  '/ua/gra.webmanifest',
  '/uploads/favicon-192.png',
  '/uploads/favicon.png',
  '/uploads/logo-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PAGES.concat(STATIC).map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('skoczna-rider-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isGamePage(url) {
  const path = url.pathname.replace(/\/$/, '');
  return PAGES.includes(path);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && isGamePage(url)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        if (fresh.ok) event.waitUntil(cache.put(url.pathname.replace(/\/$/, ''), fresh.clone()));
        return fresh;
      } catch (_) {
        const cached = await caches.match(url.pathname.replace(/\/$/, ''));
        return cached || Response.error();
      }
    })());
    return;
  }

  // Silnik gry: network-first, zeby poprawka fizyki dochodzila do gracza od razu,
  // a nie dopiero po kolejnym wejsciu. Offline dalej dziala z cache.
  if (url.pathname === '/game.js') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) event.waitUntil(cache.put(url.pathname, fresh.clone()));
        return fresh;
      } catch (_) {
        const cached = await cache.match(url.pathname);
        return cached || Response.error();
      }
    })());
    return;
  }

  if (STATIC.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(url.pathname);
      const network = fetch(request).then((res) => {
        if (res && res.ok) event.waitUntil(cache.put(url.pathname, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })());
  }
});
