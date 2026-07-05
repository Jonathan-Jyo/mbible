const CACHE_NAME = "bible-memory-v2.5";
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
  // index.html(내비게이션)과 sw.js 자신은 브라우저 HTTP 캐시까지 우회해
  // 항상 실제 네트워크에서 최신 버전을 확인한다. 그 외 정적 자산은
  // 평소처럼 네트워크 우선 + 실패 시 캐시로 처리한다.
  const isCriticalFile = e.request.mode === "navigate" || e.request.url.endsWith("/sw.js");
  const fetchOptions = isCriticalFile ? { cache: "no-store" } : {};

  e.respondWith(
    caches.match(e.request).then((cached) => {
      return fetch(e.request, fetchOptions)
        .then((response) => {
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
