// ============================================================================
// mini-compat — 소형폰 판(mini)에만 들어간다: 이 기기가 모르는 CSS 를 <html> 에 표시한다 (v4.33.2)
// ----------------------------------------------------------------------------
//   html.no-flex-gap     flex 의 gap 을 모른다(크롬 84 전)   → css/mini-gap.css(빌드가 만든다)가 자식 사이 여백으로 대신
//   html.no-aspect-ratio aspect-ratio 를 모른다(크롬 88 전) → css/mini-fix.css 가 높이로 대신
// 최신 기기에서 mini 를 열면 표시가 붙지 않아 대체 규칙이 걸리지 않는다(여백이 두 번 붙지 않게).
// ⚠ 옛 WebView 에서 돌아야 한다 — var · function 만
// ============================================================================
(function () {
  "use strict";
  var root = document.documentElement;
  function add(c) { root.className = (root.className ? root.className + " " : "") + c; }
  // flex gap — 세로 flex 상자에 빈 자식 둘, gap 1px → 아는 기기는 높이 1
  try {
    var box = document.createElement("div");
    box.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden;";
    box.appendChild(document.createElement("div"));
    box.appendChild(document.createElement("div"));
    root.appendChild(box);
    var knows = box.scrollHeight === 1;
    root.removeChild(box);
    if (!knows) add("no-flex-gap");
  } catch (e) { add("no-flex-gap"); }
  var ar = typeof CSS !== "undefined" && CSS.supports && CSS.supports("aspect-ratio", "1");
  if (!ar) add("no-aspect-ratio");
})();
