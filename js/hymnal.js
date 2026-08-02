// ============================================================================
// Hymnal — 찬미가 (가사 .hdb + 악보 .cmp)
// ----------------------------------------------------------------------------
// 원래 성경읽기앱 안에 있던 기능을 매일찬양으로 옮기면서 따로 뽑아낸 모듈이다.
//
// 자료는 옮기지 않았다. 찬미가는 처음부터 성경 역본들과 같은 그릇
// (IndexedDB "bible-bdb-store")에 딱지만 다르게 붙어 들어 있다.
//   · hym:<이름>     가사 — SQLite, hymnal(chapter, title, htext) 테이블
//   · hymimg:<이름>  악보 — zip 안에 <번호>.png
// 그래서 이 모듈은 그 그릇을 그대로 읽기만 한다. 파일을 불러오고 지우는 일은
// 지금처럼 성경읽기 ⚙ 설정 › 성경 DB 관리 한 곳에서만 한다 —
// 같은 그릇에 쓰는 곳이 두 군데가 되면 언젠가 서로 어긋난다.
//
// 음원(MR)은 아직 없다. 자리만 만들어 두었다 — docs/찬미가-반주기-설계.md 참고.
// ============================================================================

const Hymnal = (() => {
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 가사는 HTML이 섞여 온다 — 보이는 서식은 살리고 실행되는 것만 걷어낸다
  function sanitize(html) {
    return String(html || "")
      .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/javascript:/gi, "");
  }

  let _src = null;        // 지금 보고 있는 가사 .hdb의 id
  let _max = 0;           // 마지막 곡 번호
  let _cur = 0;           // 지금 열어 둔 곡
  let _mode = "lyrics";   // lyrics | score
  let _zoom = 1;
  const _zips = {};       // 악보 zip 캐시
  const _dbs = {};        // sql.js 인스턴스 캐시
  let _sqlP = null;
  let _jszipP = null;

  function toast(msg) {
    if (typeof window.toast === "function") return window.toast(msg);
    if (typeof window.showToast === "function") return window.showToast(msg);
    console.log(msg);
  }

  function ensureJSZip() {
    if (window.JSZip) return Promise.resolve(true);
    if (_jszipP) return _jszipP;
    _jszipP = new Promise(res => {
      const s = document.createElement("script");
      s.src = "lib/jszip.min.js";
      s.onload = () => res(true); s.onerror = () => res(false);
      document.head.appendChild(s);
    });
    return _jszipP;
  }
  function initSql() {
    if (!_sqlP) _sqlP = initSqlJs({ locateFile: f => "lib/sqljs/" + f });
    return _sqlP;
  }
  async function openDb(id) {
    if (_dbs[id]) return _dbs[id];
    const bytes = await BdbStore.getBytes(id);
    if (!bytes) throw new Error("찬미가 자료를 찾을 수 없습니다.");
    const SQL = await initSql();
    return (_dbs[id] = new SQL.Database(new Uint8Array(bytes)));
  }

  async function listLyrics() {
    let list = []; try { list = await BdbStore.list(); } catch (e) {}
    return list.filter(x => x.id.startsWith("hym:")).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  }
  async function listScores() {
    let list = []; try { list = await BdbStore.list(); } catch (e) {}
    return list.filter(x => x.id.startsWith("hymimg:")).sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  }
  async function hasAny() { return (await listLyrics()).length > 0; }

  // ── 목록 ────────────────────────────────────────────────────────────
  async function renderList() {
    const body = $("#hym-body"); if (!body) return;
    if (!_src) {
      const lys = await listLyrics();
      if (!lys.length) {
        body.innerHTML = `<div class="hym-msg">
          아직 찬미가 자료가 없습니다.<br><br>
          <b>성경읽기 ⚙ 설정 › 성경 DB 관리</b>에서<br>
          가사(<code>.hdb</code>)와 악보(<code>.cmp</code>) 파일을 불러오면<br>
          여기에 바로 나타납니다.
        </div>`;
        return;
      }
      _src = lys[0].id;
    }
    const q = (($("#hym-search") || {}).value || "").trim();
    try {
      const db = await openDb(_src);
      let sql = `SELECT chapter, title FROM hymnal WHERE title IS NOT NULL`;
      if (/^\d+$/.test(q)) sql += ` AND chapter=${+q}`;
      else if (q) {
        for (const w of q.split(/\s+/).filter(Boolean)) {
          const e = w.replace(/'/g, "''");
          sql += ` AND (title LIKE '%${e}%' OR htext LIKE '%${e}%')`;
        }
      }
      sql += ` ORDER BY chapter LIMIT 400`;
      const r = db.exec(sql);
      if (!r.length) { body.innerHTML = `<div class="hym-msg">검색 결과가 없습니다.</div>`; return; }
      body.innerHTML = r[0].values.map(([c, t]) =>
        `<div class="hym-item">
           <span class="hym-no">${c}</span><span class="hym-title">${esc(t)}</span>
           <span class="hym-acts">
             <button data-c="${c}" data-m="lyrics">가사</button>
             <button data-c="${c}" data-m="score">악보</button>
           </span>
         </div>`).join("");
      body.querySelectorAll(".hym-acts button").forEach(b =>
        b.addEventListener("click", () => show(+b.dataset.c, b.dataset.m)));
    } catch (e) {
      body.innerHTML = `<div class="hym-msg">찬미가를 불러오지 못했습니다.<br><small>${esc(e.message)}</small></div>`;
    }
  }

  async function maxChapter() {
    if (_max) return _max;
    try {
      const db = await openDb(_src);
      const r = db.exec(`SELECT MAX(chapter) FROM hymnal`);
      _max = (r.length && r[0].values[0][0]) || 1;
    } catch (e) { _max = 1; }
    return _max;
  }

  // ── 곡 보기 (가사 / 악보) — 전체 화면 ────────────────────────────────
  async function show(chapter, mode) {
    _cur = chapter;
    _mode = mode || _mode || "lyrics";
    const isScore = _mode === "score";
    const ov = $("#hymnal-detail"); if (!ov) return;
    ov.classList.add("show");
    const body = $("#hymd-body");
    try {
      const db = await openDb(_src);
      const r = db.exec(`SELECT title, htext FROM hymnal WHERE chapter=${chapter} LIMIT 1`);
      if (!r.length) { body.innerHTML = `<div class="hym-msg">곡을 찾을 수 없습니다.</div>`; return; }
      const [title, htext] = r[0].values[0];
      $("#hymd-title").textContent = `${chapter}. ${title}`;
      const maxC = await maxChapter();
      const seg = `<div class="hym-mode-seg">
          <button class="${isScore ? "" : "on"}" data-m="lyrics">가사</button>
          <button class="${isScore ? "on" : ""}" data-m="score">악보</button></div>`;
      const nav = `<div class="hym-nav">
          <button ${chapter <= 1 ? "disabled" : ""} data-go="${chapter - 1}">◀ 이전 곡</button>
          <span class="hym-nav-no">${chapter}</span>
          <button ${chapter >= maxC ? "disabled" : ""} data-go="${chapter + 1}">다음 곡 ▶</button></div>`;
      const content = isScore
        ? `<div class="hym-score-area" id="hym-score-wrap"><div class="hym-msg">악보 불러오는 중…</div></div>`
        : `<div class="hym-lyrics">${sanitize(String(htext || ""))}</div>`;
      body.innerHTML = `<div class="hym-detail"><div class="hym-detail-top">${seg}</div>${nav}${playerHtml(chapter, title)}${content}</div>`;
      body.scrollTop = 0;
      body.querySelectorAll(".hym-mode-seg button").forEach(b =>
        b.addEventListener("click", () => show(chapter, b.dataset.m)));
      body.querySelectorAll(".hym-nav button[data-go]").forEach(b =>
        b.addEventListener("click", () => { if (!b.disabled) show(+b.dataset.go, _mode); }));
      bindPlayer(chapter);

      if (isScore) {
        lockLandscape();
        _zoom = 1;
        const url = await scoreUrl(chapter);
        const wrap = $("#hym-score-wrap");
        if (!wrap) return;
        if (url) {
          wrap.innerHTML = `<img class="hym-score" id="hym-score-img" src="${url}" alt="악보 ${chapter}">`;
          // 확대 버튼은 화면에 고정이라, 곡을 넘길 때마다 쌓이지 않게 먼저 지운다
          document.querySelectorAll(".hym-zoom").forEach(el => el.remove());
          wrap.insertAdjacentHTML("afterend",
            `<div class="hym-zoom"><button data-z="-1">－</button><button class="fit" data-z="0">맞춤</button><button data-z="1">＋</button></div>`);
          document.querySelectorAll(".hym-zoom button").forEach(b =>
            b.addEventListener("click", () => { const d = +b.dataset.z; d ? zoom(d) : zoomFit(); }));
          attachPinch(wrap);
        } else {
          wrap.innerHTML = `<div class="hym-msg">악보 이미지가 없습니다.<br><small>악보(.cmp)를 불러오지 않았거나 이 곡이 들어 있지 않습니다.</small></div>`;
        }
      } else {
        document.querySelectorAll(".hym-zoom").forEach(el => el.remove());
        unlockOrientation();
      }
    } catch (e) {
      body.innerHTML = `<div class="hym-msg">곡을 불러오지 못했습니다.<br><small>${esc(e.message)}</small></div>`;
    }
  }

  function close() {
    unlockOrientation();
    document.querySelectorAll(".hym-zoom").forEach(el => el.remove());
    const ov = $("#hymnal-detail"); if (ov) ov.classList.remove("show");
  }

  // ── 악보 확대 ────────────────────────────────────────────────────────
  function applyZoom() { const img = $("#hym-score-img"); if (img) img.style.width = Math.round(_zoom * 100) + "%"; }
  function zoom(d) { _zoom = Math.min(6, Math.max(1, Math.round((_zoom + d * 0.5) * 10) / 10)); applyZoom(); }
  function zoomFit() { _zoom = 1; applyZoom(); }
  function attachPinch(area) {
    if (!area) return;
    let d0 = 0, z0 = 1;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    area.addEventListener("touchstart", e => { if (e.touches.length === 2) { d0 = dist(e.touches); z0 = _zoom; } }, { passive: true });
    area.addEventListener("touchmove", e => {
      if (e.touches.length === 2 && d0 > 0) {
        e.preventDefault();
        _zoom = Math.min(6, Math.max(1, Math.round(z0 * (dist(e.touches) / d0) * 100) / 100));
        applyZoom();
      }
    }, { passive: false });
    const end = e => { if (e.touches.length < 2) d0 = 0; };
    area.addEventListener("touchend", end, { passive: true });
    area.addEventListener("touchcancel", end, { passive: true });
  }
  function lockLandscape() { try { const o = screen.orientation; if (o && o.lock) o.lock("landscape").catch(() => {}); } catch (e) {} }
  function unlockOrientation() { try { const o = screen.orientation; if (o && o.unlock) o.unlock(); } catch (e) {} }

  async function scoreUrl(chapter) {
    const imgs = await listScores();
    if (!imgs.length) return null;
    const id = imgs[0].id;
    if (!(await ensureJSZip())) return null;
    try {
      let zip = _zips[id];
      if (!zip) {
        const bytes = await BdbStore.getBytes(id); if (!bytes) return null;
        zip = await JSZip.loadAsync(bytes); _zips[id] = zip;
      }
      const f = zip.file(`${chapter}.png`) || zip.file(`${chapter}.PNG`);
      if (!f) return null;
      return `data:image/png;base64,${await f.async("base64")}`;
    } catch (e) { return null; }
  }

  // ── 반주 미니플레이어 (자리만) ───────────────────────────────────────
  // 아직 음원이 없다. 음정·박자를 따로 움직이려면 MIDI 연주가 필요한데
  // (오디오는 playbackRate가 둘을 함께 바꿔 버린다) 그 자료가 아직 없어서
  // 지금은 생김새와 자리만 잡아 두고 꺼 둔다.
  // 설계 전문: docs/찬미가-반주기-설계.md
  const TUNE_KEY = "bible-hymn-tune";
  function loadTune(ch) {
    try { return (JSON.parse(localStorage.getItem(TUNE_KEY) || "{}")[ch]) || { pitch: 0, tempo: 0 }; }
    catch (e) { return { pitch: 0, tempo: 0 }; }
  }
  function saveTune(ch, t) {
    try {
      const all = JSON.parse(localStorage.getItem(TUNE_KEY) || "{}");
      if (!t.pitch && !t.tempo) delete all[ch]; else all[ch] = t;
      localStorage.setItem(TUNE_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  function playerHtml(chapter) {
    const t = loadTune(chapter);
    return `<details class="hym-player" id="hym-player">
      <summary><span class="hp-cap">🎹 반주</span><span class="hp-state">음원 없음</span></summary>
      <div class="hp-body">
        <div class="hp-seekrow"><span class="hp-t">0:00</span>
          <input type="range" class="hp-seek" min="0" max="100" value="0" disabled><span class="hp-t">0:00</span></div>
        <div class="hp-transport">
          <button class="hp-play" disabled title="재생">▶</button>
          <button class="hp-loop" disabled title="구간 반복">🔁</button>
        </div>
        <div class="hp-tune">
          <span class="hp-label">음정</span>
          <button class="hp-step" data-k="pitch" data-d="-1">▼</button>
          <b class="hp-val" data-v="pitch">${t.pitch}</b>
          <button class="hp-step" data-k="pitch" data-d="1">▲</button>
          <span class="hp-label hp-label2">박자</span>
          <button class="hp-step" data-k="tempo" data-d="-1">◀</button>
          <b class="hp-val" data-v="tempo">${t.tempo}</b>
          <button class="hp-step" data-k="tempo" data-d="1">▶</button>
        </div>
        <div class="hp-note">반주 음원을 넣으면 음정과 박자를 따로 조절할 수 있습니다.<br>
          지금 맞춰 두신 값은 곡마다 저장됩니다.</div>
      </div>
    </details>`;
  }
  const LIM = { pitch: 6, tempo: 5 };
  function bindPlayer(chapter) {
    const box = document.querySelector("#hym-player"); if (!box) return;
    box.querySelectorAll(".hp-step").forEach(b => b.addEventListener("click", (e) => {
      e.preventDefault();
      const k = b.dataset.k, lim = LIM[k];
      const t = loadTune(chapter);
      t[k] = Math.max(-lim, Math.min(lim, (t[k] || 0) + (+b.dataset.d)));
      saveTune(chapter, t);
      const out = box.querySelector(`.hp-val[data-v="${k}"]`);
      if (out) out.textContent = t[k] > 0 ? `+${t[k]}` : `${t[k]}`;
    }));
  }

  // ── 화면 진입 ────────────────────────────────────────────────────────
  function init() {
    const q = $("#hym-search");
    if (q) q.addEventListener("input", renderList);
    const x = $("#hymd-close");
    if (x) x.addEventListener("click", close);
    const ov = $("#hymnal-detail");
    if (ov) ov.addEventListener("click", e => { if (e.target === ov) close(); });
  }

  return { init, renderList, show, close, hasAny, listLyrics, listScores };
})();
