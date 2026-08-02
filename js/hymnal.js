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
        b.addEventListener("click", () => { setSearchOpen(false); show(+b.dataset.c, b.dataset.m); }));
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
      // 머리줄 한 줄에 다 담는다 — 악보를 보러 온 화면이라 본문 위 자리를 아낀다
      ov.classList.toggle("is-score", isScore);
      $("#hymd-prev").disabled = chapter <= 1;
      $("#hymd-next").disabled = chapter >= maxC;
      const mb = $("#hymd-mode");
      mb.textContent = isScore ? "📄" : "🎼";
      mb.title = isScore ? "가사 보기" : "악보 보기";

      const content = isScore
        ? `<div class="hym-score-area" id="hym-score-wrap"><div class="hym-msg">악보 불러오는 중…</div></div>`
        : `<div class="hym-lyrics">${sanitize(String(htext || ""))}</div>`;
      // 악보를 볼 때는 반주 패널이 본문을 밀지 않도록 아래에 떠 있게 한다
      body.innerHTML = isScore
        ? `${content}${playerHtml(chapter)}`
        : `<div class="hym-detail">${playerHtml(chapter)}${content}</div>`;
      body.scrollTop = 0;
      bindPlayer(chapter);
      document.querySelectorAll(".hym-zoom").forEach(el => el.remove());   // 곡을 넘길 때 쌓이지 않게

      if (isScore) {
        lockLandscape();
        _view = null;
        const url = await scoreUrl(chapter);
        const wrap = $("#hym-score-wrap");
        if (!wrap) return;
        if (url) {
          wrap.innerHTML = `<img class="hym-score" id="hym-score-img" src="${url}" alt="악보 ${chapter}">`;
          document.querySelectorAll(".hym-zoom").forEach(el => el.remove());
          wrap.insertAdjacentHTML("afterend",
            `<div class="hym-zoom"><button data-z="-1">－</button><button class="fit" data-z="0">맞춤</button><button data-z="1">＋</button></div>`);
          document.querySelectorAll(".hym-zoom button").forEach(b =>
            b.addEventListener("click", () => { const d = +b.dataset.z; d ? zoom(d) : zoomFit(); }));
          mountScoreViewer(wrap, $("#hym-score-img"));
        } else {
          wrap.innerHTML = `<div class="hym-msg">악보 이미지가 없습니다.<br><small>악보(.cmp)를 불러오지 않았거나 이 곡이 들어 있지 않습니다.</small></div>`;
        }
      } else {
        _view = null;
        unlockOrientation();
      }
    } catch (e) {
      body.innerHTML = `<div class="hym-msg">곡을 불러오지 못했습니다.<br><small>${esc(e.message)}</small></div>`;
    }
  }

  function close() {
    unlockOrientation();
    _view = null;
    document.querySelectorAll(".hym-zoom").forEach(el => el.remove());
    const ov = $("#hymnal-detail"); if (ov) ov.classList.remove("show", "is-score");
  }
  function step(d) { const n = _cur + d; if (n >= 1) show(n, _mode); }
  function toggleMode() { show(_cur, _mode === "score" ? "lyrics" : "score"); }

  // ── 악보 보기 (확대·이동) ────────────────────────────────────────────
  // 예전에는 img의 width(%)만 키우고 스크롤에 맡겼다. 그래서 두 손가락으로
  // 벌려도 늘 왼쪽 위를 기준으로 커졌고, 브라우저 스크롤이 축을 하나로
  // 잠가 버려 대각선으로 못 움직였다.
  // 이제 transform으로 직접 그린다 —
  //   · 확대: 두 손가락 사이 지점을 붙잡아 두고 키운다(손가락 기준)
  //   · 이동: 한 손가락으로 아무 방향이나(대각선 포함)
  let _view = null;   // { scale, tx, ty, ... } 지금 열려 있는 악보
  function mountScoreViewer(wrap, img) {
    const st = { scale: 1, tx: 0, ty: 0, baseW: 0, baseH: 0 };
    const measure = () => {
      st.baseW = wrap.clientWidth;
      st.baseH = img.naturalWidth ? wrap.clientWidth * (img.naturalHeight / img.naturalWidth) : img.offsetHeight;
    };
    const clamp = () => {
      const cw = wrap.clientWidth, ch = wrap.clientHeight;
      const w = st.baseW * st.scale, h = st.baseH * st.scale;
      // 화면보다 작으면 가운데로, 크면 빈틈이 보이지 않게 붙인다
      st.tx = w <= cw ? (cw - w) / 2 : Math.min(0, Math.max(cw - w, st.tx));
      st.ty = h <= ch ? Math.max(0, (ch - h) / 2) : Math.min(0, Math.max(ch - h, st.ty));
    };
    const draw = () => { clamp(); img.style.transform = `translate(${st.tx}px, ${st.ty}px) scale(${st.scale})`; };
    // 화면 위 한 점(f)을 붙잡은 채로 배율만 바꾼다
    const zoomAt = (next, fx, fy) => {
      const s2 = Math.min(6, Math.max(1, next));
      st.tx = fx - (fx - st.tx) * (s2 / st.scale);
      st.ty = fy - (fy - st.ty) * (s2 / st.scale);
      st.scale = s2;
      draw();
    };
    measure(); draw();
    img.addEventListener("load", () => { measure(); draw(); });
    window.addEventListener("resize", () => { measure(); draw(); });

    const pts = new Map();          // 지금 화면에 닿아 있는 손가락들
    let last = null, pinch = null;
    const rel = (e) => { const r = wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    wrap.addEventListener("pointerdown", (e) => {
      wrap.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, rel(e));
      if (pts.size === 1) last = rel(e);
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: st.scale };
        last = null;
      }
    });
    wrap.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      e.preventDefault();
      pts.set(e.pointerId, rel(e));
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        zoomAt(pinch.s * (d / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);   // 손가락 가운데를 기준으로
      } else if (pts.size === 1 && last) {
        const p = rel(e);
        st.tx += p.x - last.x; st.ty += p.y - last.y;   // 가로·세로를 함께 — 대각선으로 움직인다
        last = p; draw();
      }
    }, { passive: false });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      last = pts.size === 1 ? [...pts.values()][0] : null;
    };
    wrap.addEventListener("pointerup", up);
    wrap.addEventListener("pointercancel", up);
    wrap.addEventListener("pointerleave", up);
    // 마우스 휠(데스크톱)도 커서 기준으로
    wrap.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = rel(e);
      zoomAt(st.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), p.x, p.y);
    }, { passive: false });

    _view = {
      step(d) { zoomAt(st.scale + d * 0.5, wrap.clientWidth / 2, wrap.clientHeight / 2); },
      fit() { st.scale = 1; st.tx = 0; st.ty = 0; measure(); draw(); },
      get scale() { return st.scale; }
    };
  }
  function zoom(d) { if (_view) _view.step(d); }
  function zoomFit() { if (_view) _view.fit(); }
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

  // ── 검색창 접기 ──────────────────────────────────────────────────────
  // 곡을 고르고 나면 검색창은 할 일을 다 한 것이다. 접어서 🔍 버튼만 남기면
  // 목록이 그만큼 더 보인다.
  function setSearchOpen(on) {
    const bar = $("#hym-sticky"); if (!bar) return;
    bar.classList.toggle("open", !!on);
    if (on) setTimeout(() => { const i = $("#hym-search"); if (i) i.focus(); }, 50);
  }
  function clearSearch() {
    const i = $("#hym-search");
    if (i && i.value) { i.value = ""; renderList(); }
    setSearchOpen(false);
  }

  // ── 화면 진입 ────────────────────────────────────────────────────────
  function init() {
    const q = $("#hym-search");
    if (q) q.addEventListener("input", renderList);
    const tg = $("#hym-search-btn"); if (tg) tg.addEventListener("click", () => setSearchOpen(!$("#hym-sticky").classList.contains("open")));
    const cl = $("#hym-search-x");   if (cl) cl.addEventListener("click", clearSearch);
    const x = $("#hymd-close");      if (x) x.addEventListener("click", close);
    const p = $("#hymd-prev");       if (p) p.addEventListener("click", () => step(-1));
    const n = $("#hymd-next");       if (n) n.addEventListener("click", () => step(1));
    const m = $("#hymd-mode");       if (m) m.addEventListener("click", toggleMode);
    const ov = $("#hymnal-detail");
    if (ov) ov.addEventListener("click", e => { if (e.target === ov) close(); });
  }

  return { init, renderList, show, close, hasAny, listLyrics, listScores };
})();
