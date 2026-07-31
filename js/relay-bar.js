// ============================================================================
// RelayBar — 자체 플레이어가 없는 화면(성경읽기·성경암송·허브)에서
// 매일찬양·매일기도가 넘겨준 재생을 이어 듣는 최소 미니바.
// ----------------------------------------------------------------------------
// PlayRelay에 저장된 상태가 있을 때만 나타난다. 곡 이름·▶⏸·⏭·✕ 만 두고,
// 다음 화면으로 또 넘어갈 때를 대비해 계속 PlayRelay.save()로 이어 둔다.
// 이 화면들은 PraiseStore/PraiseAudio(음원 IndexedDB)를 몰라도 되게
// 만들어져 있었으므로, 아래 두 모듈이 로드돼 있을 때만 조용히 동작한다.
// ============================================================================
(function () {
  if (typeof PlayRelay === "undefined" || typeof PraiseStore === "undefined" || typeof PraiseAudio === "undefined") return;
  const state = PlayRelay.load();
  if (!state) return;

  const ids = state.ids;
  let idx = Math.min(Math.max(state.idx || 0, 0), ids.length - 1);
  let firstLoad = true;   // 맨 처음 곡만 저장된 위치(초)에서 이어 튼다

  const audio = new Audio();
  audio.preload = "auto";

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

  const bar = document.createElement("div");
  bar.id = "relay-bar";
  bar.innerHTML =
    '<button id="rb-toggle" aria-label="재생/일시정지">▶</button>' +
    '<div id="rb-title"></div>' +
    '<button id="rb-next" aria-label="다음 곡">⏭</button>' +
    '<button id="rb-close" aria-label="끄기">✕</button>';
  const css = document.createElement("style");
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

  function titleOf(id) { const it = PraiseStore.items().find(x => x.id === id); return it ? it.title : "음악"; }
  function render() {
    document.getElementById("rb-title").textContent = titleOf(ids[idx]);
    document.getElementById("rb-toggle").textContent = audio.paused ? "▶" : "⏸";
  }
  // 이 화면 자신의 스크롤 여백·다른 하단 바 위치를 이 바 높이에 맞춰 조정할 수 있도록
  // 실측한 높이를 CSS 변수로 남기고, 켜져 있는 동안 표시용 클래스를 붙인다.
  function markHeight() {
    document.body.classList.add("relay-bar-on");
    // rAF는 백그라운드/비활성 탭에서 한없이 미뤄질 수 있어 setTimeout을 쓴다
    setTimeout(() => {
      document.documentElement.style.setProperty("--relay-bar-h", bar.offsetHeight + "px");
    }, 0);
  }
  function saveRelay() {
    PlayRelay.save({ ids, idx, pos: audio.currentTime || 0, playing: !audio.paused, mode: state.mode, source: state.source });
  }
  async function playCurrent() {
    const url = await PraiseAudio.getURL(ids[idx]);
    if (!url) { next(); return; }
    if (audio.src && audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
    audio.src = url;
    try { if (state.playing) await audio.play(); }
    catch (e) {}   // 자동재생이 막히면 ▶ 로 남는다 — 한 번 눌러 이어 듣기
    render(); saveRelay();
  }
  function next() {
    if (!ids.length) return;
    idx = (idx + 1) % ids.length;
    playCurrent();
  }
  function stop() {
    audio.pause();
    if (audio.src && audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
    PlayRelay.clear();
    bar.remove(); css.remove();
    document.body.classList.remove("relay-bar-on");
    document.documentElement.style.removeProperty("--relay-bar-h");
  }

  audio.addEventListener("loadedmetadata", () => {
    if (firstLoad) { audio.currentTime = state.pos || 0; firstLoad = false; }
  });
  audio.addEventListener("ended", next);
  audio.addEventListener("error", () => next());
  audio.addEventListener("play", () => { render(); saveRelay(); });
  audio.addEventListener("pause", () => { render(); saveRelay(); });

  document.body.appendChild(bar);
  markHeight();
  window.addEventListener("resize", markHeight);
  document.getElementById("rb-toggle").addEventListener("click", () => {
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  });
  document.getElementById("rb-next").addEventListener("click", next);
  document.getElementById("rb-close").addEventListener("click", stop);
  window.addEventListener("pagehide", saveRelay);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveRelay(); });

  playCurrent();
})();
