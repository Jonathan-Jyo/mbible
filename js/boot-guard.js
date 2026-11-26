// ============================================================================
// boot-guard — 화면이 시작하지 못하면 까닭을 보여 준다 (v4.33.1 · 5.33.2 · 3.33.2 · 꺼짐 알림 4.33.3 · 앱 전체 꺼짐 4.33.6 · 활동 기록 4.33.8)
// ----------------------------------------------------------------------------
// 옛 WebView 는 새 문법(?. ?? 등)을 모르면 그 스크립트 파일을 통째로 버린다. 그러면 화면은
// 「불러오는 중…」에 멈춘 채 아무 말도 하지 않는다(S45 Pro · 안드로이드 10 · 제조사 WebView, 2026-11-26).
// 이 파일은 모든 화면에서 **가장 먼저** 읽히고, 그 일을 잡아 화면에 적는다.
//
//   · 스크립트 문법 오류(SyntaxError)가 나면 → 곧바로 알림 창
//   · 성경읽기가 12초 뒤에도 「불러오는 중」이면 → 알림 창
//   · 알림 창에는 WebView 판 · 안드로이드 판 · 실제 오류 문장 · 진단 화면(diag.html) 길
//   · (v4.33.3) 화면 일꾼(렌더러)이 죽어 앱이 화면을 새로 열었으면 → 위에 「방금 화면이 꺼졌습니다 — 까닭」 띠
//     (기록은 앱 본체의 RendererGuard 가 남긴다. window.RendererGoneText 는 diag.html 도 쓴다)
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

  // ── 화면 꺼짐 기록(RendererGuard) ──
  // 우선순위 2=중요(이 앱이 거는 값) · 1=보통 · 0=낮음 — 「중요」인데도 정리됐으면 메모리가 크게 모자란 것이다
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // 안드로이드가 보낸 「메모리를 줄여라」 단계(onTrimMemory) — 15 가 화면에 있는 앱에게 보내는 가장 급한 단계
  var TRIM = { 5: "조금 모자람", 10: "모자람", 15: "매우 모자람(위급)", 20: "화면에서 내려감", 40: "뒤에 있음", 60: "뒤에서 정리 후보", 80: "곧 정리됨" };
  function memText(o) {
    if (o.availMB == null) return "";
    return "남은 메모리 " + o.availMB + "MB / " + o.totalMB + "MB" + (o.low ? " · 메모리 부족 신호 켜짐" : "") +
      " · 이 앱 " + o.pssMB + "MB" + (o.trim >= 0 ? " · 마지막 경고: " + (TRIM[o.trim] || o.trim) : "");
  }
  function goneText(o) {
    var d = new Date(+o.at || 0);
    var app = o.who === "app";
    var why = app ? (o.fg ? "앱 전체가 화면에 있을 때 갑자기 꺼졌습니다" : "앱이 뒤에 있을 때 꺼졌습니다") + (o.playing ? "(소리를 틀던 중)" : "")
      : o.crash ? "화면 부품(WebView)이 스스로 멈췄습니다(충돌)"
      : "메모리가 모자라 안드로이드가 화면 부품을 정리했습니다";
    return {
      why: why,
      when: (d.getMonth() + 1) + "/" + d.getDate() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()),
      who: app ? "앱 전체(직전 기록)" : o.who === "player" ? "숨은 재생 화면" : "보던 화면",
      page: leaf(o.url) || "-",
      prio: o.priority === 2 ? "중요" : o.priority === 1 ? "보통" : o.priority === 0 ? "낮음" : "모름",
      mem: memText(o)
    };
  }
  // 알릴 만한 꺼짐인가 — 보던 화면이 꺼졌거나, 앱 전체가 화면에 있을 때 · 소리를 틀던 중에 꺼진 것
  function notable(o) { return o && (o.who === "main" || (o.who === "app" && (o.fg || o.playing))); }
  window.RendererGoneText = goneText;

  function goneNotice(items) {
    var pick = null, nMain = 0;
    for (var i = 0; i < items.length; i++) if (notable(items[i])) { nMain++; if (!pick) pick = items[i]; }
    if (!pick) return;   // 숨은 재생 화면만 다시 띄운 것·뒤에서 정리된 것은 알리지 않는다(진단 화면에는 남는다)
    var t = goneText(pick);
    var head = pick.who === "app" ? "⚠ 앞서 앱이 갑자기 꺼졌습니다" : "⚠ 방금 화면이 꺼졌다가 다시 열렸습니다";
    var bar = document.createElement("div");
    bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:2147482000;background:#12152a;color:#eef0f6;" +
      "font:14px/1.5 sans-serif;border-radius:12px;padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,.35)";
    bar.innerHTML = "<b>" + esc(head) + "</b><br>까닭: " + esc(t.why) + (t.mem ? "<br>" + esc(t.mem) : "") +
      "<br><span style=\"color:#a3a9bd;font-size:12.5px\">" + esc(t.when) + " · " + esc(t.page) +
      (nMain > 1 ? " · 최근 " + nMain + "번" : "") + " · 자세히는 진단 화면</span>" +
      "<div style=\"text-align:right;margin-top:6px\"><a href=\"diag.html\" style=\"color:#d9b45b;margin-right:16px\">🩺 진단</a>" +
      "<button type=\"button\" id=\"bg-gone-x\" style=\"background:#2a2f4d;color:#eef0f6;border:1px solid #4a5076;border-radius:8px;padding:4px 12px\">닫기</button></div>";
    (document.body || document.documentElement).appendChild(bar);
    var x = document.getElementById("bg-gone-x");
    if (x) x.onclick = function () { bar.parentNode.removeChild(bar); };
  }

  function checkGone() {
    if (leaf(location.pathname) === "diag.html") return;   // 진단 화면은 목록을 따로 그린다(「알렸음」으로 치지 않게)
    var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.RendererLog;
    if (!P || !P.pending) return;
    try {
      P.pending().then(function (r) { if (r && r.items && r.items.length) goneNotice(r.items); }, function () { /* 기록이 없으면 그만 */ });
    } catch (e) { /* 앱 밖(브라우저)에서는 없다 */ }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", checkGone);
  else checkGone();

  // ── 활동 기록(v4.33.8, 소형폰 판) — 메모리가 갑자기 뛰기 직전에 무슨 일이 있었나 ──
  // 앱 본체(LifeLog)에 곧바로 적는다 — 화면 쪽 저장소(localStorage)는 갑자기 꺼지면 남지 않을 수 있다.
  //   열림 · 누름(단추 글자) · 스크롤(3초에 한 번) · 가림/보임 · 불러옴(주소·크기) · 5초마다 화면 JS 메모리
  //   다른 스크립트는 window.__act("…") 로 더한다(성경읽기의 장·역본, 자료 열기)
  var ACT_SCROLL_MS = 3000, ACT_HEAP_MS = 5000, ACT_SAME_MS = 1000;
  var lastAct = "", lastActAt = 0;
  function actPlugin() {
    var C = window.Capacitor;
    return C && C.Plugins && C.Plugins.RendererLog && C.Plugins.RendererLog.act ? C.Plugins.RendererLog : null;
  }
  function heapMB() {
    var m = window.performance && performance.memory;
    return m && m.usedJSHeapSize ? Math.round(m.usedJSHeapSize / 1048576) : -1;
  }
  function act(t) {
    if (!window.MINI_EDITION) return;   // 소형폰 판만(판 표시는 이 파일 뒤에 읽히므로 부를 때 본다)
    var now = Date.now();
    if (t && t === lastAct && now - lastActAt < ACT_SAME_MS) return;
    lastAct = t; lastActAt = now;
    var P = actPlugin();
    if (!P) return;
    try { P.act({ t: leaf(location.pathname) + " · " + t, heap: heapMB() }); } catch (e) { /* 앱 밖 */ }
  }
  window.__act = act;
  function label(el) {
    var t = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || el.id || el.className || el.tagName;
    return String(t).replace(/\s+/g, " ").replace(/^\s|\s$/g, "").slice(0, 30);
  }
  if (actPlugin() || window.Capacitor) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { act("열림"); });
    else act("열림");
    document.addEventListener("click", function (e) {
      var el = e.target;
      for (var i = 0; el && i < 5 && el !== document.body; i++, el = el.parentNode) {
        if (el.tagName === "BUTTON" || el.tagName === "A" || el.tagName === "SELECT" || (el.getAttribute && (el.getAttribute("onclick") || el.getAttribute("role") === "button"))) break;
      }
      if (el && el !== document.body && el.getAttribute) act("누름 " + label(el));
    }, true);
    var lastScroll = 0;
    document.addEventListener("scroll", function (e) {
      var now = Date.now();
      if (now - lastScroll < ACT_SCROLL_MS) return;
      lastScroll = now;
      var t = e.target && e.target.id ? "#" + e.target.id : "화면";
      var top = e.target && e.target.scrollTop != null ? e.target.scrollTop : window.pageYOffset;
      act("스크롤 " + t + " " + Math.round(top || 0));
    }, true);
    document.addEventListener("visibilitychange", function () { act(document.hidden ? "가림" : "보임"); });
    setInterval(function () {
      var P = window.MINI_EDITION && actPlugin();
      if (P) { try { P.act({ t: "", heap: heapMB() }); } catch (e) { /* 앱 밖 */ } }
    }, ACT_HEAP_MS);
    // 불러옴 — 주소(앞부분)와, 알 수 있으면 크기
    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function (input) {
        var url = String(input && input.url ? input.url : input).replace(location.origin, "").slice(0, 80);
        var p = origFetch.apply(this, arguments);
        p.then(function (r) {
          var n = r && r.headers && r.headers.get && r.headers.get("content-length");
          act("불러옴 " + url + (n ? " " + Math.round(n / 1024) + "KB" : ""));
        }, function () { act("불러오기 실패 " + url); });
        return p;
      };
    }
  }

  // 성경읽기가 오래도록 「불러오는 중」이면
  setTimeout(function () {
    var r = document.getElementById("reader");
    var stuck = r && r.querySelector && r.querySelector(".loading");
    if (stuck) show("성경 본문이 " + (STUCK_MS / 1000) + "초가 지나도 열리지 않습니다.");
  }, STUCK_MS);
})();
