// ============================================================================
// 판 번호 — 이 파일 한 곳에서만 고친다
// ----------------------------------------------------------------------------
// 화면(첫화면·성경읽기·성경암송 설정)과 안드로이드 빌드(android/app/build.gradle),
// 가벼운 판 빌드(scripts/build-light.sh)가 모두 여기를 읽는다. 다른 데 숫자를 적지 않는다.
//   name  항상예수께로(Salt) 판 · light  가벼운 판 · code  안드로이드 versionCode(늘 +1)
// 규칙: 주.부.수정 — 새 기능은 부, 고침은 수정. 바꾼 점은 CHANGELOG.md 에.
// ============================================================================
window.APP_VERSION = { name: "5.23.0", light: "3.23.0", code: 127, date: "2026-10-05" };

// 판 번호를 보여 줄 자리를 채운다 — data-app-ver 를 단 요소. 가벼운 판이면 그 번호로.
(function () {
  function fill() {
    const V = window.APP_VERSION;
    const v = "v" + (window.LIGHT_EDITION ? V.light : V.name);
    document.querySelectorAll("[data-app-ver]").forEach(el => { el.textContent = v; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill);
  else fill();
})();
