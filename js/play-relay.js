// ============================================================================
// PlayRelay — 페이지를 옮겨도 음악이 이어지는 느낌을 준다
// ----------------------------------------------------------------------------
// 이 앱은 SPA가 아니라 페이지마다 완전히 새로 불러오는 구조라, 음악을 틀어
// 둔 채 다른 화면(성경읽기·성경암송 등)으로 넘어가면 <audio>가 그 자리에서
// 사라진다. 완전한 백그라운드 재생(네이티브 서비스)까지는 가지 않고, 대신
// "재생 목록·위치·재생 여부"를 아주 짧게만 넘겨 다음 페이지가 열리자마자
// 이어 틀게 해서 체감 끊김을 없앤다.
//   · 매일찬양·매일기도: 재생하는 동안 계속 이 상태를 저장해 둔다
//   · 성경읽기·성경암송·허브: 저장된 상태를 발견하면 최소 미니바로 이어 튼다
// (js/relay-bar.js)
// 20초 넘게 지난 상태는 신뢰하지 않는다 — 오래 자리를 비웠다 다시 열었는데
// 갑자기 음악이 흘러나오는 것은 이어재생이 아니라 오작동으로 느껴진다.
// ============================================================================
const PlayRelay = (() => {
  const KEY = "bible-play-relay";
  const STALE_MS = 20000;

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(Object.assign({ savedAt: Date.now() }, state))); }
    catch (e) {}
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!s || !Array.isArray(s.ids) || !s.ids.length) return null;
      if (Date.now() - (s.savedAt || 0) > STALE_MS) return null;
      return s;
    } catch (e) { return null; }
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  return { save, load, clear };
})();
