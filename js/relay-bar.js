// ============================================================================
// RelayBar — 자체 플레이어가 없는 화면(성경읽기·허브)에서 지금 도는 찬양을 조절하는 최소 미니바.
// ----------------------------------------------------------------------------
// 소리는 재생 엔진이 낸다(js/play-engine.js). 이 바는 리모컨이다 — 곡 이름·▶⏸·⏭·✕ 만 둔다.
// 엔진에 재생 목록이 있을 때만 나타난다.
//  · 안드로이드 앱: 엔진이 화면 밖에서 계속 돌고 있어, 이 화면이 열려도 소리가 끊기지 않는다
//  · 브라우저: 앞 화면이 PlayRelay 로 넘겨준 재생을 이어받아 이 화면에서 튼다
// 이 화면들은 PraiseStore(곡 목록)를 몰라도 되게 만들어져 있었으므로,
// 엔진과 곡 목록이 로드돼 있을 때만 조용히 동작한다.
// ============================================================================
(function () {
  if (typeof PlayEngine === "undefined" || typeof PraiseStore === "undefined") return;
  const E = PlayEngine;
  let bar = null, css = null;

  // 화면 맨 아래에 이미 고정된 바(탭바·하단 아이콘줄 등)가 있으면 그 위에,
  // 없으면 화면 아래에서 살짝 띄운다 — 픽셀을 짐작하지 않고 실측한다.
  function bottomCss() {
    const candidates = [".lesson-nav", ".foot", ".tabbar", ".bottom-dock", ".rec-bar"];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      // 화면 끝에서 살짝 떨어져 있어도(반올림·기기별 오차) 바닥에 붙은 것으로 본다
      if (r.height > 0 && window.innerHeight - r.bottom < 30) return (Math.round(r.height) + 8) + "px";
    }
    return "calc(14px + env(safe-area-inset-bottom, 0px))";
  }

  // 이 화면 자신의 스크롤 여백·다른 하단 바 위치를 이 바 높이에 맞춰 조정할 수 있도록
  // 실측한 높이를 CSS 변수로 남기고, 켜져 있는 동안 표시용 클래스를 붙인다.
  function markHeight() {
    if (!bar) return;
    document.body.classList.add("relay-bar-on");
    // rAF는 백그라운드/비활성 탭에서 한없이 미뤄질 수 있어 setTimeout을 쓴다
    setTimeout(() => {
      if (bar) document.documentElement.style.setProperty("--relay-bar-h", bar.offsetHeight + "px");
    }, 0);
  }

  function build() {
    bar = document.createElement("div");
    bar.id = "relay-bar";
    bar.innerHTML =
      '<button id="rb-toggle" aria-label="재생/일시정지">▶</button>' +
      '<div id="rb-title"></div>' +
      '<button id="rb-next" aria-label="다음 곡">⏭</button>' +
      '<button id="rb-close" aria-label="끄기">✕</button>';
    css = document.createElement("style");
    css.textContent =
      "#relay-bar{position:fixed;left:10px;right:10px;z-index:500;bottom:" + bottomCss() + ";" +
      "display:flex;align-items:center;gap:8px;background:var(--surface,var(--card,#202544));" +
      "border:1px solid var(--line,rgba(255,255,255,.14));border-radius:14px;padding:9px 12px;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35);font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;}" +
      "#relay-bar button{background:none;border:none;color:var(--text,#e8e9f0);font-size:17px;cursor:pointer;padding:2px 6px;flex-shrink:0;}" +
      "#rb-toggle{color:var(--gold,#d9b45b);font-size:19px;}" +
      "#rb-close{color:var(--dim,#8b90a8);font-size:13px;}" +
      "#rb-title{flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--text,#e8e9f0);" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}";
    document.head.appendChild(css);
    document.body.appendChild(bar);
    bar.querySelector("#rb-toggle").addEventListener("click", () => E.cmd("toggle"));
    bar.querySelector("#rb-next").addEventListener("click", () => E.cmd("next"));
    bar.querySelector("#rb-close").addEventListener("click", () => E.cmd("stop"));
    markHeight();
  }
  function remove() {
    bar.remove(); css.remove();
    bar = css = null;
    document.body.classList.remove("relay-bar-on");
    document.documentElement.style.removeProperty("--relay-bar-h");
  }

  function render(st) {
    if (!st.ids.length) { if (bar) remove(); return; }
    if (!bar) build();
    bar.querySelector("#rb-title").textContent = st.title;
    bar.querySelector("#rb-toggle").textContent = st.paused ? "▶" : "⏸";
  }

  E.subscribe((st) => { if (st.ev !== "time") render(st); });
  window.addEventListener("resize", markHeight);
  E.adoptRelay();   // 브라우저: 앞 화면이 넘겨준 재생을 이어받는다(앱에서는 엔진이 이미 돌고 있다)
  render(E.state);
})();
