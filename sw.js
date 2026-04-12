const CACHE_NAME = "bible-memory-v2";
const SHELL_FILES = [
  "./index.html",
  "./css/style.css",
  "./js/data.js",
  "./js/app.js",
  "./js/memorize.js",
  "./js/highlight.js",
  "./js/audio.js",
  "./manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => {
      // 네트워크 우선, 실패 시 캐시
      return fetch(e.request)
        .then((response) => {
          // 성공 시 캐시 업데이트
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
