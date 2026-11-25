// ============================================================================
// boot-guard — 화면이 시작하지 못하면 까닭을 보여 준다 (v4.33.1 · 5.33.2 · 3.33.2)
// ----------------------------------------------------------------------------
// 옛 WebView 는 새 문법(?. ?? 등)을 모르면 그 스크립트 파일을 통째로 버린다. 그러면 화면은
// 「불러오는 중…」에 멈춘 채 아무 말도 하지 않는다(S45 Pro · 안드로이드 10 · 제조사 WebView, 2026-11-26).
// 이 파일은 모든 화면에서 **가장 먼저** 읽히고, 그 일을 잡아 화면에 적는다.
//
//   · 스크립트 문법 오류(SyntaxError)가 나면 → 곧바로 알림 창
//   · 성경읽기가 12초 뒤에도 「불러오는 중」이면 → 알림 창
//   · 알림 창에는 WebView 판 · 안드로이드 판 · 실제 오류 문장 · 진단 화면(diag.html) 길
//
// ⚠ 이 파일 자체는 옛 WebView 에서도 돌아야 한다 — var · function 만 쓴다
//   (let/const/=>/?./??/템플릿 문자열/class 를 쓰지 않는다)
// ============================================================================
(function () {
  "use strict";
  var errs = [];
  var shown = false;
  var STUCK_MS = 12000;

  function add(msg) {
    if (!msg) return;
    for (var i = 0; i < errs.length; i++) if (errs[i] === msg) return;
    if (errs.length < 8) errs.push(msg);
    try { sessionStorage.setItem("boot-guard-errors", errs.join(" | ")); } catch (e) { /* 진단 화면에 넘기지 못해도 그만 */ }
  }
  function leaf(path) {
    var s = String(path || "");
    return s.substring(s.lastIndexOf("/") + 1).split("?")[0];
  }
  function chromeVer() {
    var m = /Chrome\/(\d+)/.exec(navigator.userAgent || "");
    return m ? m[1] : "";
  }
  function androidVer() {
    var m = /Android\s([\d.]+)/.exec(navigator.userAgent || "");
    return m ? m[1] : "";
  }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;";
    });
  }

  function show(why) {
    if (shown) return;
    shown = true;
    var cv = chromeVer();
    var box = document.createElement("div");
    box.setAttribute("role", "alertdialog");
    box.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483000;overflow-y:auto;" +
      "background:#12152a;color:#eef0f6;font:15px/1.6 sans-serif;padding:20px 16px;";
    var list = "";
    for (var i = 0; i < errs.length; i++) list += "<li>" + esc(errs[i]) + "</li>";
    box.innerHTML =
      "<div style=\"max-width:520px;margin:0 auto\">" +
      "<div style=\"font-size:19px;font-weight:bold;margin:0 0 8px\">⚠ 이 기기에서 화면이 제대로 시작하지 못했습니다</div>" +
      "<div style=\"color:#c9cede;margin:0 0 12px\">" + esc(why) + "</div>" +
      "<div style=\"background:#1c2038;border:1px solid #353a58;border-radius:12px;padding:10px 12px;margin:0 0 12px\">" +
      "WebView(화면 부품): <b>" + (cv ? cv + " 판" : "알 수 없음") + "</b><br>" +
      "안드로이드: <b>" + (androidVer() || "알 수 없음") + "</b><br>" +
      "앱: <b>" + esc((window.APP_VERSION && (window.MINI_EDITION ? window.APP_VERSION.mini : window.LIGHT_EDITION ? window.APP_VERSION.light : window.APP_VERSION.name)) || "?") + "</b> · 화면: <b>" + esc(leaf(location.pathname) || "index.html") + "</b>" +
      (cv && +cv < 80 ? "<br><span style=\"color:#f0b35b\">80 판보다 낮은 WebView 는 이 앱의 스크립트를 읽지 못합니다.</span>" : "") +
      "</div>" +
      (list ? "<div style=\"font-weight:bold;margin:0 0 4px\">오류</div><ol style=\"margin:0 0 12px;padding-left:20px;font-size:13px;word-break:break-all\">" + list + "</ol>" : "") +
      "<a href=\"diag.html\" style=\"display:block;text-align:center;background:#d9b45b;color:#1c1608;font-weight:bold;" +
      "text-decoration:none;border-radius:12px;padding:14px 10px;margin:0 0 10px\">🩺 진단 화면 열기</a>" +
      "<div style=\"font-size:13px;color:#a3a9bd\">이 화면이나 진단 화면을 사진으로 찍어 보내 주시면 원인을 찾을 수 있습니다.</div>" +
      "<button type=\"button\" id=\"bg-close\" style=\"margin-top:12px;width:100%;padding:12px;border-radius:12px;border:1px solid #4a5076;" +
      "background:#2a2f4d;color:#eef0f6;font-size:15px\">닫고 그대로 보기</button>" +
      "</div>";
    (document.body || document.documentElement).appendChild(box);
    var x = document.getElementById("bg-close");
    if (x) x.onclick = function () { box.parentNode.removeChild(box); };
  }

  // 스크립트 오류 — 그림·파일을 못 불러온 것(e.message 없음)은 빼고
  window.addEventListener("error", function (e) {
    if (!e || !e.message) return;
    add(e.message + (e.filename ? " — " + leaf(e.filename) + (e.lineno ? ":" + e.lineno : "") : ""));
    if (/SyntaxError|Unexpected token|Invalid or unexpected|Unexpected identifier|missing \) after/i.test(e.message)) {
      setTimeout(function () { show("스크립트 파일 하나를 이 기기의 WebView 가 읽지 못했습니다(문법 오류). 그래서 화면이 멈췄습니다."); }, 1500);
    }
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    add("약속 실패: " + (r && (r.message || r)));
  });

  // 성경읽기가 오래도록 「불러오는 중」이면
  setTimeout(function () {
    var r = document.getElementById("reader");
    var stuck = r && r.querySelector && r.querySelector(".loading");
    if (stuck) show("성경 본문이 " + (STUCK_MS / 1000) + "초가 지나도 열리지 않습니다.");
  }, STUCK_MS);
})();
