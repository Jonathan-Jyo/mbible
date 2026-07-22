// ============================================================================
// 서비스워커 — 성경절암송 + 성경읽기 공용
// · APP_VER를 올리면(배포 시) 모든 기기가 다음 접속에서 자동으로 새 캐시로 교체
// · 전략: 네트워크 우선(성공 시 캐시 갱신) → 오프라인이면 캐시 폴백
// · 내비게이션(html)과 sw.js 자신은 HTTP 캐시까지 우회(no-store)해 항상 최신 확인
// ============================================================================
const APP_VER = "2026-07-22l";            // ← 배포 때마다 갱신
const CACHE_NAME = "bible-apps-" + APP_VER;

const SHELL_FILES = [
  "./index.html",
  "./reader.html",
  "./manifest.json",
  "./css/style.css",
  "./css/card-composer.css",
  "./js/data.js",
  "./js/app.js",
  "./js/memorize.js",
  "./js/highlight.js",
  "./js/audio.js",
  "./js/audio-store.js",
  "./js/user-verses.js",
  "./js/favorites.js",
  "./js/image-store.js",
  "./js/memo-log.js",
  "./js/module-manager.js",
  "./js/data-exchange.js",
  "./js/card-composer.js",
  "./js/gwanju.js",
  "./js/bdb-store.js",
  "./js/bible-db.js",
  "./lib/sqljs/sql-wasm.js",
  "./lib/sqljs/sql-wasm.wasm",
  "./lib/jszip.min.js",
  "./lib/html2canvas.min.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // 하나 실패해도 나머지는 캐시되도록 allSettled 사용
      .then((cache) => Promise.allSettled(SHELL_FILES.map((f) => cache.add(f))))
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
  if (e.request.method !== "GET") return;
  const isCritical = e.request.mode === "navigate" || e.request.url.endsWith("/sw.js");
  const fetchOptions = isCritical ? { cache: "no-store" } : {};

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
