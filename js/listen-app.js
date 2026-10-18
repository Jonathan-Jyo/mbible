"use strict";
// ─────────────────────────────────────────────────────────────────────
// 👂 말씀듣기 — tojesus 폴더의 성경 오디오·예언의신 오디오·설교 (listen.html)
//
//   📖 성경    audiobible/<역본>/<01_창세기>/<001.mp3>   역본 › 책(구약·신약) › 장 칸
//   🎙 예언의신 audioegw/<KR…>/<책>/<001_제목.mp3>     언어 › 책 › 장 줄
//   📻 설교·책  audiosermon/<설교자·책>/…              묶음 › 파일 줄
//
//   장을 누르면 그 책(묶음)의 파일을 차례로 튼다 — 그 파일부터, 들은 자리가 있으면 거기서(js/tj-audio.js).
//   소리는 재생 엔진(js/play-engine.js)이 낸다. 이 화면은 리모컨이다.
// ─────────────────────────────────────────────────────────────────────
(() => {
  const $ = (s) => document.querySelector(s);
  const E = PlayEngine, A = TjAudio;
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const coll = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
  const plugin = () => (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins && Capacitor.Plugins.TojesusFolder) || null;
  const TABS = {
    bible:  { area: "audiobible",  label: "성경",     ico: "📖" },
    egw:    { area: "audioegw",    label: "예언의신", ico: "🎙" },
    sermon: { area: "audiosermon", label: "설교·책",  ico: "📻" }
  };
  const LANG = { KR: "한국어", EN: "English", CN: "中文", JP: "日本語", ID: "Bahasa Indonesia" };
  const LANG_ORDER = ["KR", "EN", "CN", "JP", "ID"];
  const OT_BOOKS = 39;
  const SLEEPS = [0, 15, 30, 60];
  const TAB_KEY = "bible-listen-tab";

  let tab = "bible", path = [];
  const trees = {};                 // 구역 → 나무 { dirs: {이름: 나무}, files: [경로] }

  function toast(m) {
    const t = $("#toast"); t.textContent = m; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2400);
  }
  const mmss = (s) => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  };

  function applyScheme() {
    let s = "dark";
    try { s = localStorage.getItem("bible-color-scheme") || "light"; } catch (e) { /* 기본값 */ }
    const eff = s === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : s;
    document.documentElement.dataset.theme = eff;
    if (typeof syncStatusBar === "function") syncStatusBar(eff);
  }

  // ── 폴더 나무 ───────────────────────────────────────────────────────
  async function loadTree(area, force) {
    if (trees[area] && !force) return trees[area];
    const r = await plugin().scan({ sub: area });
    const mk = () => ({ dirs: Object.create(null), files: [] });   // 폴더 이름이 constructor 여도 되게
    const root = mk();
    for (const f of r.files || []) {
      if (!A.AUDIO_EXT.test(f.path)) continue;
      const seg = f.path.split("/").slice(1);          // 구역 이름은 뗀다
      let n = root;
      for (const d of seg.slice(0, -1)) n = n.dirs[d] || (n.dirs[d] = mk());
      n.files.push(f.path);
    }
    trees[area] = root;
    return root;
  }
  const nodeAt = (root, p) => p.reduce((n, d) => (n && n.dirs[d]) || null, root);
  const countFiles = (n) => n.files.length + Object.values(n.dirs).reduce((a, d) => a + countFiles(d), 0);
  const sortedDirs = (n) => Object.keys(n.dirs).sort(coll.compare);
  const sortedFiles = (n) => n.files.slice().sort((a, b) => coll.compare(a.split("/").pop(), b.split("/").pop()));

  // ── 그리기 ─────────────────────────────────────────────────────────
  const nowRel = () => (A.isId(E.state.id) ? A.relOf(E.state.id) : "");

  function fileMeta(rel) {
    const p = A.posOf(rel);
    if (!p) return { cls: "", meta: "", pct: 0 };
    if (p.done) return { cls: "done", meta: "✓ 들음", pct: 0 };
    return { cls: "", meta: p.dur ? `${mmss(p.pos)} / ${mmss(p.dur)}` : mmss(p.pos), pct: p.dur ? Math.min(1, p.pos / p.dur) : 0 };
  }

  function renderResume() {
    const box = $("#resume");
    const L = A.last();
    if (!L || !L.rel || !plugin()) { box.innerHTML = ""; return; }
    const p = A.posOf(L.rel) || {};
    const pct = p.dur ? Math.min(1, (p.pos || 0) / p.dur) : 0;
    box.innerHTML = `<div class="resume" id="resume-card" role="button" tabindex="0">
      <div style="flex:1;min-width:0">
        <div class="rk">이어 듣기</div>
        <div class="rt">${esc(L.title || A.titleOf(L.rel))}</div>
        <div class="rs">${p.done ? "끝까지 들었습니다 — 다음 파일부터" : p.pos ? `${mmss(p.pos)}${p.dur ? " / " + mmss(p.dur) : ""}부터` : "처음부터"}</div>
      </div>
      <button class="rplay" aria-label="이어 듣기">▶</button>
      <div class="rbar"><i style="transform:scaleX(${pct})"></i></div>
    </div>`;
    $("#resume-card").addEventListener("click", resumeLast);
  }

  function resumeLast() {
    const L = A.last();
    if (!L || !Array.isArray(L.list) || !L.list.length) return;
    let start = L.rel;
    const p = A.posOf(start);
    if (p && p.done) {                                  // 다 들은 것이면 다음 것부터
      const i = L.list.indexOf(start);
      if (i >= 0 && i + 1 < L.list.length) start = L.list[i + 1];
    }
    play(L.list, start);
  }

  function renderCrumbs() {
    const t = TABS[tab];
    const parts = [`<button data-depth="0">${t.ico} ${esc(t.label)}</button>`];
    path.forEach((d, i) => {
      parts.push(`<span class="sep">›</span>`);
      const label = labelOf(i, d);
      parts.push(i === path.length - 1 ? `<span class="cur">${esc(label)}</span>` : `<button data-depth="${i + 1}">${esc(label)}</button>`);
    });
    $("#crumbs").innerHTML = parts.join("");
    $("#crumbs").querySelectorAll("[data-depth]").forEach(b => b.addEventListener("click", () => { path = path.slice(0, +b.dataset.depth); render(); }));
  }
  // 칸 이름을 사람이 읽는 말로 — 「01_창세기」→ 창세기, 「KR」→ 한국어
  function labelOf(depth, name) {
    if (tab === "egw" && depth === 0) return LANG[name.toUpperCase()] || name;
    return A.dropNum(name);
  }

  // 그리기는 폴더를 읽느라 기다린다 — 그사이 다른 칸을 눌렀으면 늦게 끝난 옛 그리기가 덮어쓰지 않게
  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    const stale = () => seq !== renderSeq;
    renderResume();
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
    renderCrumbs();
    const body = $("#body");
    if (!plugin()) {
      body.innerHTML = `<div class="note">말씀듣기는 <b>안드로이드 앱(APK)</b>에서 됩니다.<br>tojesus 폴더의 오디오를 그 자리에서 읽기 때문입니다.</div>`;
      return;
    }
    const st = await plugin().status();
    if (stale()) return;
    if (!st.linked || !st.ok) {
      body.innerHTML = `<div class="note">tojesus 자료 폴더가 연결되어 있지 않습니다.<br>
        <a href="index.html?set=file">첫화면 ⚙ 설정 › 파일관리 › 🔄 재등록</a>에서 먼저 연결해 주세요.</div>`;
      return;
    }
    const area = TABS[tab].area;
    if (!trees[area]) body.innerHTML = `<div class="note">${esc(area)} 폴더를 읽는 중…</div>`;
    let root;
    try { root = await loadTree(area); }
    catch (e) { if (!stale()) body.innerHTML = `<div class="note">폴더를 읽지 못했습니다 — ${esc((e && e.message) || e)}</div>`; return; }
    if (stale()) return;
    // 묶음이 하나뿐이면(역본 하나·언어 하나) 바로 안으로
    if (!path.length && (tab === "bible" || tab === "egw") && !root.files.length && Object.keys(root.dirs).length === 1) {
      path = [Object.keys(root.dirs)[0]];
      renderCrumbs();
    }
    const node = nodeAt(root, path);
    if (!node) { path = []; return render(); }
    if (!countFiles(node)) {
      body.innerHTML = `<div class="note">아직 오디오가 없습니다.<br>tojesus/<b>${esc(area)}</b>/ 에 넣고 ⟳ 를 누르세요.<br>
        <span style="font-size:var(--fs-hint)">${esc(guideOf(area))}</span></div>`;
      return;
    }
    body.innerHTML = renderNode(node);
    bindBody(node);
  }
  function guideOf(area) {
    return area === "audiobible" ? "예) audiobible/개역한글/01_창세기/001.mp3"
      : area === "audioegw" ? "예) audioegw/KR/시대의소망/001.mp3 (KR·EN·CN·JP·ID)"
      : "예) audiosermon/설교자이름/2026-10-18_제목.mp3";
  }

  function renderNode(node) {
    const dirs = sortedDirs(node), files = sortedFiles(node);
    const now = nowRel();
    let html = "";
    if (dirs.length) {
      const card = (d) => {
        const n = node.dirs[d], c = countFiles(n);
        const playing = now && now.split("/").slice(1).slice(0, path.length + 1).join("/") === [...path, d].join("/");
        const ico = tab === "egw" && !path.length ? "🌐" : tab === "bible" && path.length === 1 ? "📕" : "📁";
        return `<button class="folder${playing ? " now" : ""}" data-dir="${esc(d)}"><span class="fi">${ico}</span>
          <span class="fn">${esc(labelOf(path.length, d))}</span><span class="fc">${c}</span></button>`;
      };
      // 성경의 책은 구약·신약으로 나눈다(앞 번호 1~39 구약)
      if (tab === "bible" && path.length === 1) {
        const ot = dirs.filter(d => (A.numOf(d) || 99) <= OT_BOOKS), nt = dirs.filter(d => !ot.includes(d));
        if (ot.length) html += `<div class="sec-h">구약</div><div class="grid">${ot.map(card).join("")}</div>`;
        if (nt.length) html += `<div class="sec-h">신약</div><div class="grid">${nt.map(card).join("")}</div>`;
      } else {
        const ordered = tab === "egw" && !path.length
          ? dirs.slice().sort((a, b) => ((LANG_ORDER.indexOf(a.toUpperCase()) + 1) || 99) - ((LANG_ORDER.indexOf(b.toUpperCase()) + 1) || 99))
          : dirs;
        html += `<div class="grid">${ordered.map(card).join("")}</div>`;
      }
    }
    if (files.length) {
      if (dirs.length) html += `<div class="sec-h">파일</div>`;
      if (tab === "bible") {
        html += `<div class="chapters">${files.map(rel => {
          const m = fileMeta(rel), n = A.numOf(A.stripExt(rel.split("/").pop()));
          return `<button class="ch ${m.cls}${rel === now ? " now" : ""}" data-file="${esc(rel)}" aria-label="${n}장${m.meta ? " " + m.meta : ""}">${n != null ? n : "?"}${m.pct ? `<i class="pb" style="transform:scaleX(${m.pct})"></i>` : ""}</button>`;
        }).join("")}</div>`;
      } else {
        html += files.map(rel => {
          const m = fileMeta(rel), file = rel.split("/").pop();
          const name = tab === "egw" ? A.chapterLabel(file) : A.stripExt(file);
          return `<button class="row ${m.cls}${rel === now ? " now" : ""}" data-file="${esc(rel)}">
            <span class="rn">${rel === now ? "🔊 " : ""}${esc(name)}</span><span class="rm">${esc(m.meta)}</span>
            ${m.pct ? `<i class="pb" style="transform:scaleX(${m.pct})"></i>` : ""}</button>`;
        }).join("");
      }
    }
    return html;
  }

  function bindBody(node) {
    const body = $("#body");
    body.querySelectorAll("[data-dir]").forEach(b => b.addEventListener("click", () => { path = [...path, b.dataset.dir]; render(); window.scrollTo(0, 0); }));
    const files = sortedFiles(node);
    body.querySelectorAll("[data-file]").forEach(b => b.addEventListener("click", () => {
      const rel = b.dataset.file;
      if (rel === nowRel()) { E.cmd("toggle"); return; }   // 듣던 것을 또 누르면 멈춤·재생
      play(files, rel);
    }));
  }

  function play(list, startRel) {
    E.cmd("playList", { list: list.map(A.idOf), start: A.idOf(startRel), mode: "order", source: "listen" });
  }

  // ── 미니 플레이어 ──────────────────────────────────────────────────
  let seeking = false, sleepIdx = 0;
  function renderPlayer() {
    const st = E.state, on = st.ids.length > 0;
    $("#player").classList.toggle("show", on);
    if (!on) return;
    $("#pl-title").textContent = st.title || "";
    $("#pl-toggle").textContent = st.paused ? "▶" : "⏸";
    $("#pl-rate").textContent = (st.rate || 1) + "×";
    $("#pl-rate").classList.toggle("on", (st.rate || 1) !== 1);
    const left = st.sleepEndAt ? Math.max(0, Math.round((st.sleepEndAt - Date.now()) / 60000)) : 0;
    $("#pl-sleep").textContent = left ? `🌙${left}` : "🌙";
    $("#pl-sleep").classList.toggle("on", !!left);
    renderSeek();
  }
  function renderSeek() {
    if (seeking) return;
    const st = E.state;
    $("#pl-seek").value = st.dur ? Math.round(st.pos / st.dur * 1000) : 0;
    $("#pl-cur").textContent = mmss(st.pos);
    $("#pl-dur").textContent = mmss(st.dur);
  }
  function bindPlayer() {
    $("#pl-toggle").addEventListener("click", () => E.cmd("toggle"));
    $("#pl-prev").addEventListener("click", () => E.cmd("prev"));
    $("#pl-next").addEventListener("click", () => E.cmd("next"));
    $("#pl-back").addEventListener("click", () => E.cmd("skip", { sec: -15 }));
    $("#pl-fwd").addEventListener("click", () => E.cmd("skip", { sec: 15 }));
    $("#pl-close").addEventListener("click", () => E.cmd("stop"));
    $("#pl-rate").addEventListener("click", () => {
      const R = E.RATES || [1], i = R.indexOf(E.state.rate || 1);
      const r = R[(i + 1) % R.length];
      E.cmd("setRate", { rate: r });
      toast(`빠르기 ${r}×`);
    });
    $("#pl-sleep").addEventListener("click", () => {
      sleepIdx = (sleepIdx + 1) % SLEEPS.length;
      E.cmd("setSleep", { min: SLEEPS[sleepIdx] });
      toast(SLEEPS[sleepIdx] ? `🌙 ${SLEEPS[sleepIdx]}분 뒤 멈춥니다` : "수면 타이머를 껐습니다");
    });
    const sk = $("#pl-seek");
    sk.addEventListener("input", () => { seeking = true; $("#pl-cur").textContent = mmss(sk.value / 1000 * (E.state.dur || 0)); });
    sk.addEventListener("change", () => { seeking = false; if (E.state.dur) E.cmd("seek", { sec: sk.value / 1000 * E.state.dur }); });
  }

  // 들은 자리·지금 파일 표시는 곡이 바뀌거나 멈출 때만 다시 그린다(0.45초마다 그리지 않는다)
  E.subscribe((st) => {
    if (st.ev === "time") { renderSeek(); return; }
    renderPlayer();
    if (["track", "pause", "end", "stop", "play"].includes(st.ev)) {
      const area = TABS[tab].area, root = trees[area];
      renderResume();
      const node = root && nodeAt(root, path);
      if (node) { $("#body").innerHTML = renderNode(node); bindBody(node); }
    }
    if (st.ev === "nofiles") toast("이 파일을 열지 못했습니다 — tojesus 폴더를 확인해 주세요");
    if (st.ev === "end") toast("끝까지 들었습니다");
    if (st.ev === "sleep") toast("🌙 수면 타이머 — 멈췄습니다");
  });

  function init() {
    applyScheme();
    const q = new URLSearchParams(location.search);
    try { tab = q.get("tab") || localStorage.getItem(TAB_KEY) || "bible"; } catch (e) { tab = "bible"; }
    if (!Object.prototype.hasOwnProperty.call(TABS, tab)) tab = "bible";
    document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => {
      tab = b.dataset.tab; path = [];
      try { localStorage.setItem(TAB_KEY, tab); } catch (e) { /* 다음에 성경부터 */ }
      render();
    }));
    $("#refresh-btn").addEventListener("click", async () => {
      const area = TABS[tab].area;
      delete trees[area];
      toast("폴더를 다시 읽습니다");
      await render();
    });
    bindPlayer();
    renderPlayer();
    render();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
