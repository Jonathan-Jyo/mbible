// ============================================================================
// 서비스워커 — 성경절암송 + 성경읽기 공용
// · APP_VER를 올리면(배포 시) 모든 기기가 다음 접속에서 자동으로 새 캐시로 교체
// · 전략: 네트워크 우선(성공 시 캐시 갱신) → 오프라인이면 캐시 폴백
// · 내비게이션(html)과 sw.js 자신은 HTTP 캐시까지 우회(no-store)해 항상 최신 확인
// ============================================================================
const APP_VER = "2026-08-04f";            // ← 배포 때마다 갱신
const CACHE_NAME = "bible-apps-" + APP_VER;
const DATA_CACHE = "bible-data-v2";   // 불변 자산(성경 JSON·lib) — 버전 갱신에도 유지
                                      // ※ 성경 JSON 내용이 바뀌면(역본 추가 등) 반드시 이 번호를 올릴 것

const SHELL_FILES = [
  "./index.html",
  "./key.html",
  "./reader.html",
  "./pray.html",
  "./praise.html",
  "./share.html",
  "./js/crypt.js",
  "./js/card-exchange.js",
  "./js/share-store.js",
  "./js/share-app.js",
  "./js/id3.js",
  "./js/praise-store.js",
  "./js/praise-app.js",
  "./js/hymnal.js",
  "./js/hymn-source.js",
  "./js/hymn-folder.js",
  "./js/pray-store.js",
  "./js/pray-app.js",
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
  "./js/tags.js",
  "./js/hub-calendar.js",
  "./js/attach-store.js",
  "./js/drive-sync.js",
  "./js/local-folder.js",
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
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== DATA_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  // ── 불변 자산(성경 본문 JSON·라이브러리)은 캐시 우선 ──────────────────
  //  · 내용이 바뀌지 않으므로 한 번 받으면 재다운로드 불필요
  //  · 버전과 무관한 DATA_CACHE에 보관 → 앱 업데이트해도 다시 받지 않음
  //  · 성구사전처럼 여러 책(1MB±)을 조회하는 기능의 온라인 속도를 크게 개선
  if (/\/data\/bible-db\/[^/?]+\.json(\?|$)/.test(e.request.url) || /\/lib\//.test(e.request.url)) {
    e.respondWith(
      // 캐시 미스일 때는 HTTP 캐시까지 우회(reload) — 그러지 않으면 브라우저 디스크에
      // 남아 있던 예전 성경 JSON을 새 DATA_CACHE에 그대로 다시 담아 버린다.
      caches.match(e.request).then((hit) => hit || fetch(e.request, { cache: "reload" }).then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(DATA_CACHE).then((c) => c.put(e.request, clone)); }
        return res;
      }))
    );
    return;
  }

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
