"use strict";
// ─────────────────────────────────────────────────────────────────────
// 👂 말씀듣기 — tojesus 폴더의 성경 오디오·예언의신 오디오·설교 (listen.html)
//
//   📖 성경    audiobible/<역본>/<01_창세기>/<001.mp3>   역본 › 책(구약·신약) › 장 칸
//   🎙 예언의신 audioegw/<KR…>/<책>/<001_제목.mp3>     언어 › 책 › 장 줄
//   📻 설교·책  audiosermon/<설교자·책>/…              묶음 › 파일 줄
//
//   ⚙ 설정    폴더 위치(자동 찾기·다른 폴더 고르기) · 기본 빠르기 · 건너뛰기 15/30초 · 들은 기록 지우기 · 백업
//   (v5.29.0 — 여섯째 미니앱. 아래 메뉴줄 넷, 라벤더 한 색. 설계 docs/tojesus-자료폴더-설계.md 10항)
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
    bible:  { area: "audiobible",  label: "성경듣기",   ico: "📖" },
    egw:    { area: "audioegw",    label: "예언의신듣기", ico: "🎙" },
    sermon: { area: "audiosermon", label: "설교듣기", ico: "📻" },
    set:    { area: "",            label: "설정",     ico: "⚙" }
  };
  const LANG = { KR: "한국어", EN: "English", CN: "中文", JP: "日本語", ID: "Bahasa Indonesia" };
  const LANG_ORDER = ["KR", "EN", "CN", "JP", "ID"];
  const OT_BOOKS = 39;
  const SLEEPS = [0, 15, 30, 60];
  const TAB_KEY = "bible-listen-tab";
  const RATE_KEY = "bible-listen-rate";     // 목록을 새로 틀 때의 빠르기
  const SKIP_KEY = "bible-listen-skip";     // 건너뛰기 15 · 30초
  const SKIPS = [15, 30];
  const TONGDOK_KEY = "bible-reader-tongdok";   // 성경읽기 통독 기록 — **읽기만** 한다(듣기와 읽기는 다른 기록)

  const getNum = (k, d, ok) => { try { const v = +localStorage.getItem(k); return ok.includes(v) ? v : d; } catch (e) { return d; } };
  const setNum = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* 이번만 */ } };
  const skipSec = () => getNum(SKIP_KEY, 15, SKIPS);
  const defRate = () => getNum(RATE_KEY, 1, E.RATES || [1]);
  // 성경읽기에서 읽은 장 — { "책번호|장": 날짜 }
  function readMap() {
    try { return (JSON.parse(localStorage.getItem(TONGDOK_KEY) || "{}") || {}).read || {}; } catch (e) { return {}; }
  }

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
    document.querySelectorAll("#tabs button").forEach(b => {
      b.classList.toggle("on", b.dataset.tab === tab);
      b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false");
    });
    const body = $("#body");
    if (tab === "set") { $("#resume").innerHTML = ""; $("#crumbs").innerHTML = ""; return renderSettings(body, stale); }
    renderResume();
    renderCrumbs();
    if (!plugin()) {
      body.innerHTML = `<div class="note">말씀듣기는 <b>안드로이드 앱(APK)</b>에서 됩니다.<br>tojesus 폴더의 오디오를 그 자리에서 읽기 때문입니다.<br>
        <span style="font-size:var(--fs-hint)">브라우저에서는 폴더를 읽을 수 없습니다 — 휴대폰·태블릿의 「항상예수께로」 앱에서 열어 주세요.</span></div>`;
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
        // 책 번호는 책 칸의 앞 번호(「01_창세기」→ 1) — 성경읽기 통독 기록의 열쇠와 같다
        const book = path.length >= 2 ? A.numOf(path[path.length - 1]) : null;
        const reads = book ? readMap() : {};
        let anyRead = false;
        const nums = A.chapterMap(files);   // 「마태복음20」처럼 책 이름 뒤에 장 번호가 붙은 파일도(쉬운성경)
        const cells = files.map(rel => {
          const m = fileMeta(rel), n = nums[rel];
          const rd = book && n != null && reads[`${book}|${n}`];
          if (rd) anyRead = true;
          return `<button class="ch ${m.cls}${rel === now ? " now" : ""}" data-file="${esc(rel)}" aria-label="${n}장${m.meta ? " " + m.meta : ""}${rd ? " · 성경읽기에서 읽음" : ""}">${rd ? `<i class="rd" aria-hidden="true"></i>` : ""}${n != null ? n : "?"}${m.pct ? `<i class="pb" style="transform:scaleX(${m.pct})"></i>` : ""}</button>`;
        }).join("");
        html += `<div class="legend"><span>✓ 들음</span>${anyRead ? `<span><i class="dot"></i>성경읽기에서 읽음</span>` : ""}</div>`;
        html += `<div class="chapters">${cells}</div>`;
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
    if ((E.state.rate || 1) !== defRate()) E.cmd("setRate", { rate: defRate() });   // ⚙ 설정의 기본 빠르기로 시작
  }

  // ── ⚙ 설정 ─────────────────────────────────────────────────────────
  let bkMounted = false;
  async function renderSettings(body, stale) {
    const P = plugin();
    let st = null;
    if (P) { try { st = await P.status(); } catch (e) { st = null; } }
    if (stale()) return;
    const where = !P ? "브라우저에서는 폴더를 읽을 수 없습니다 — 안드로이드 앱에서 됩니다."
      : !st || !st.linked ? "아직 연결하지 않았습니다."
      : !st.ok ? "⚠ tojesus 폴더에 닿지 않습니다 — SD카드가 빠졌거나 허락이 거둬졌습니다."
      : `<b>${esc(st.where)} › ${esc(st.path)}</b> (${st.way === "auto" ? "자동으로 찾음" : "직접 고른 폴더"})`;
    const rates = E.RATES || [1], r = defRate(), k = skipSec();
    const nPos = Object.keys(A.positions()).length;
    body.innerHTML = `
      <section class="set-card">
        <h2>📂 폴더 위치</h2>
        <div class="desc">${where}<br>기본은 내장 저장소·SD카드 맨 위의 <b>tojesus</b> 를 알아서 찾습니다(모든 파일 접근 허락).
          다른 곳의 폴더를 고르면 그 폴더가 먼저입니다.</div>
        ${P ? `<div class="seg">
          ${st && st.ok && st.way === "auto" ? "" : `<button class="set-btn" id="set-auto">자동으로 찾기</button>`}
          <button class="set-btn" id="set-pick">다른 폴더 고르기</button>
          <a class="set-btn" href="index.html?set=file" style="text-decoration:none">파일관리 · 🔄 재등록</a>
        </div>` : ""}
      </section>
      ${P ? `<section class="set-card">
        <h2>📖 언어별 기본 듣기 역본</h2>
        <div class="desc">성경읽기 「👂 이 장 듣기」는 읽는 역본과 같은 오디오가 있으면 그것으로 틉니다.
          없으면 <b>같은 언어</b>의 오디오에서 — 여럿이면 여기 정한 역본으로, 정하지 않았으면 처음 한 번 묻습니다.</div>
        <div id="set-biblever"><div class="desc">성경 오디오 폴더를 읽는 중…</div></div>
      </section>` : ""}
      <section class="set-card">
        <h2>⏩ 기본 빠르기</h2>
        <div class="desc">목록을 새로 틀 때 이 빠르기로 시작합니다. 듣는 중에는 재생 막대의 「1×」로 바꿉니다. 매일찬양은 늘 1배입니다.</div>
        <div class="seg" id="set-rate">${rates.map(x => `<button data-rate="${x}" class="${x === r ? "on" : ""}" aria-pressed="${x === r}">${x}×</button>`).join("")}</div>
      </section>
      <section class="set-card">
        <h2>↺ 건너뛰기</h2>
        <div class="desc">재생 막대의 뒤로·앞으로 단추가 건너뛰는 길이입니다.</div>
        <div class="seg" id="set-skip">${SKIPS.map(x => `<button data-skip="${x}" class="${x === k ? "on" : ""}" aria-pressed="${x === k}">${x}초</button>`).join("")}</div>
      </section>
      <section class="set-card">
        <h2>🗑 들은 기록</h2>
        <div class="desc">들은 자리·「✓ 들음」·이어 듣기를 기억하는 파일 ${nPos}개. 오디오 파일은 지우지 않습니다.
          성경읽기의 통독 기록과는 따로입니다.</div>
        <button class="set-btn warn" id="set-clear" ${nPos || A.last() ? "" : "disabled"}>들은 기록 지우기</button>
      </section>
      <section class="set-card">
        <h2>💾 백업</h2>
        <div class="desc">말씀듣기의 들은 기록만 담습니다. 오디오는 tojesus 폴더에 있어 담지 않습니다.</div>
        <div id="listen-backup-ui"></div>
      </section>
      <div class="note" style="padding:6px 0 0">말씀듣기 <span data-app-ver></span></div>`;
    const V = window.APP_VERSION;
    body.querySelectorAll("[data-app-ver]").forEach(el => { el.textContent = V ? "v" + (window.LIGHT_EDITION ? V.light : V.name) : ""; });
    bindSettings(body, P);
    if (P && st && st.ok) fillBibleVer(P, stale);
    else { const bv = $("#set-biblever"); if (bv) bv.innerHTML = `<div class="desc">tojesus 폴더가 연결되면 고를 수 있습니다.</div>`; }
    if (typeof BackupUI !== "undefined") {
      if (!bkMounted) { BackupUI.injectCSS(); bkMounted = true; }
      BackupUI.mount($("#listen-backup-ui"), { scopes: ["listen"], title: "말씀듣기" });
    }
  }

  // 📖 언어별 기본 듣기 역본 — audiobible 의 역본 폴더를 언어별로 묶어 고르게 한다(v5.32.0)
  async function fillBibleVer(P, stale) {
    let files = [];
    try { files = ((await P.scan({ sub: "audiobible" })).files || []).map(f => f.path); }
    catch (e) { console.warn("[말씀듣기] 성경 오디오 폴더를 읽지 못했습니다", e); }
    if (stale()) return;
    const box = $("#set-biblever"); if (!box) return;
    const vers = [...new Set(files.filter(p => TjAudio.AUDIO_EXT.test(p)).map(p => p.split("/")[1]).filter(Boolean))].sort();
    const byLang = {};
    vers.forEach(v => { const l = TjAudio.folderLang(TjAudio.dropNum(v)); (byLang[l] = byLang[l] || []).push(v); });
    const langs = Object.keys(byLang);
    if (!langs.length) { box.innerHTML = `<div class="desc">tojesus/audiobible 에 성경 오디오가 없습니다.</div>`; return; }
    box.innerHTML = langs.map(l => {
      const list = byLang[l], cur = TjAudio.bibleVer(l);
      const head = `<div class="desc" style="margin:10px 0 4px"><b>${esc(TjAudio.LANG_NAME[l] || l)}</b></div>`;
      if (list.length === 1) return head + `<div class="desc">${esc(TjAudio.dropNum(list[0]))} 하나뿐이라 그것으로 틉니다.</div>`;
      return head + `<div class="seg">${list.map(v => `<button data-bv-lang="${l}" data-bv="${esc(v)}" class="${v === cur ? "on" : ""}" aria-pressed="${v === cur}">${esc(TjAudio.dropNum(v))}</button>`).join("")}
        <button data-bv-lang="${l}" data-bv="" class="${cur && list.includes(cur) ? "" : "on"}" aria-pressed="${!(cur && list.includes(cur))}">처음에 묻기</button></div>`;
    }).join("");
    box.querySelectorAll("[data-bv-lang]").forEach(b => b.addEventListener("click", () => {
      TjAudio.setBibleVer(b.dataset.bvLang, b.dataset.bv);
      toast(b.dataset.bv ? `${TjAudio.LANG_NAME[b.dataset.bvLang] || ""} 기본 — ${TjAudio.dropNum(b.dataset.bv)}` : "다음에 다시 묻습니다");
      box.querySelectorAll(`[data-bv-lang="${b.dataset.bvLang}"]`).forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", on); });
    }));
  }

  function bindSettings(body, P) {
    body.querySelectorAll("[data-rate]").forEach(b => b.addEventListener("click", () => {
      setNum(RATE_KEY, +b.dataset.rate); toast(`기본 빠르기 ${b.dataset.rate}×`); render();
    }));
    body.querySelectorAll("[data-skip]").forEach(b => b.addEventListener("click", () => {
      setNum(SKIP_KEY, +b.dataset.skip); applySkipLabels(); toast(`${b.dataset.skip}초씩 건너뜁니다`); render();
    }));
    const clr = $("#set-clear");
    if (clr) clr.addEventListener("click", () => {
      if (!confirm("말씀듣기의 들은 기록(들은 자리·✓ 들음·이어 듣기)을 모두 지울까요?\n\n오디오 파일과 성경읽기 통독 기록은 그대로 둡니다. 되돌릴 수 없습니다.")) return;
      A.clearAll(); toast("들은 기록을 지웠습니다"); render();
    });
    if (!P) return;
    const relinked = () => { Object.keys(trees).forEach(k => delete trees[k]); render(); };
    const pick = $("#set-pick");
    if (pick) pick.addEventListener("click", async () => {
      try { const r = await P.pick(); if (r && r.ok) { toast("고른 폴더로 연결했습니다"); relinked(); } }
      catch (e) { alert((e && e.message) || String(e)); }
    });
    const auto = $("#set-auto");
    if (auto) auto.addEventListener("click", async () => {
      try {
        if (!P.requestAllFiles) { alert("이 앱 판에서는 자동 찾기를 못 합니다 — 앱을 새 판으로 바꿔 주세요."); return; }
        let acc = await P.allFilesStatus();
        if (!acc.granted) {
          if (!confirm("설정 창에서 「모든 파일 접근 허용」을 켜고 돌아오세요.\n\n내장 저장소·SD카드 맨 위의 tojesus 를 찾아 연결합니다.")) return;
          acc = await P.requestAllFiles();
          if (!acc.granted) { toast("허락하지 않으셨습니다"); return; }
        }
        const st = await P.status();
        let r = await P.findDefault({});
        if (!r.found && confirm("tojesus 폴더가 없습니다. 내장 저장소 맨 위에 만들까요?")) r = await P.findDefault({ create: true });
        // 찾은 뒤에야 고른 폴더를 놓는다(고른 것이 먼저이므로) — 못 찾으면 지금 연결 그대로
        // (찾은 직후의 상태는 아직 고른 폴더 기준이라 found 로만 판정한다)
        if (r.found && st.picked) await P.forget({ picked: true });
        toast(r.found ? "tojesus 를 찾아 연결했습니다" : "tojesus 를 찾지 못했습니다 — 지금 연결 그대로");
        relinked();
      } catch (e) { alert((e && e.message) || String(e)); }
    });
  }

  function applySkipLabels() {
    const k = skipSec();
    $("#pl-back").textContent = "↺" + k; $("#pl-back").title = k + "초 뒤로";
    $("#pl-fwd").textContent = k + "↻"; $("#pl-fwd").title = k + "초 앞으로";
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
    $("#pl-back").addEventListener("click", () => E.cmd("skip", { sec: -skipSec() }));
    $("#pl-fwd").addEventListener("click", () => E.cmd("skip", { sec: skipSec() }));
    applySkipLabels();
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
    if (["track", "pause", "end", "stop", "play"].includes(st.ev) && tab !== "set") {
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
      if (area) delete trees[area];
      toast("폴더를 다시 읽습니다");
      await render();
    });
    bindPlayer();
    renderPlayer();
    render();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
