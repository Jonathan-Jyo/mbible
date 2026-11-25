// ============================================================================
// mini-polyfill — 소형폰 판(mini)에만: WebView 74 에 없는 실행 기능을 채운다 (v4.33.2 — 끝 검토 뒤 더함)
// ----------------------------------------------------------------------------
// 빌드 때 변환(esbuild)은 문법만 낮추고, 없는 기능은 채워 주지 않는다(끝 검토에서 찾음).
//   Blob.prototype.text()        (크롬 76+) — 모듈·자료·백업 가져오기가 「파일을 읽을 수 없습니다」로 실패했다
//   Blob.prototype.arrayBuffer() (크롬 76+) — 찬양 파일의 태그(ID3)를 못 읽어 제목이 파일 이름으로만 나왔다
// 이미 있으면 건드리지 않는다. ⚠ 옛 WebView 에서 돌아야 한다 — var · function 만
// ============================================================================
(function () {
  "use strict";
  var B = typeof Blob !== "undefined" ? Blob : null;
  if (!B || typeof FileReader === "undefined") return;
  function read(blob, how) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r[how](blob);
    });
  }
  if (typeof B.prototype.text !== "function") {
    B.prototype.text = function () { return read(this, "readAsText"); };
  }
  if (typeof B.prototype.arrayBuffer !== "function") {
    B.prototype.arrayBuffer = function () { return read(this, "readAsArrayBuffer"); };
  }
})();
