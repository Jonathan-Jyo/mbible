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
            b.addEventListener("click", (ev) => { ev.stopPropagation(); const d = +b.dataset.z; d ? zoom(d) : zoomFit(); }));
          mountScoreViewer(wrap, $("#hym-score-img"));
          showZoom();   // 처음 한 번만 보여 주고 스스로 사라진다
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
    stopPlayer();
    closeSourceSheet();
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
      // 좌우는 가운데로, 위아래는 "위에 붙여서" — 악보는 위에서부터 읽는다.
      // (가운데 정렬을 하면 머리줄 아래로 빈 자리가 크게 생겨 악보가 내려앉는다)
      st.tx = w <= cw ? (cw - w) / 2 : Math.min(0, Math.max(cw - w, st.tx));
      st.ty = h <= ch ? 0 : Math.min(0, Math.max(ch - h, st.ty));
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
    let down = false, moved = false;   // 톡 누른 것과 끈 것을 가른다
    const rel = (e) => { const r = wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    wrap.addEventListener("pointerdown", (e) => {
      wrap.setPointerCapture(e.pointerId);
      down = true; moved = false;
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
        if (Math.hypot(p.x - last.x, p.y - last.y) > 1) moved = true;
        st.tx += p.x - last.x; st.ty += p.y - last.y;   // 가로·세로를 함께 — 대각선으로 움직인다
        last = p; draw();
      }
    }, { passive: false });
    const up = (e) => {
      // 끌지 않고 톡 눌렀으면 = 확대 단추를 보여 달라는 뜻
      if (down && !moved && pts.size === 1) showZoom();
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      last = pts.size === 1 ? [...pts.values()][0] : null;
      if (!pts.size) { down = false; moved = false; }
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
  function zoom(d) { if (_view) _view.step(d); showZoom(); }
  function zoomFit() { if (_view) _view.fit(); showZoom(); }

  // 확대 단추(－ 맞춤 ＋)는 늘 떠 있으면 반주 패널을 가린다.
  // 악보를 한 번 누를 때만 잠깐 보였다가 스스로 사라진다.
  let _zoomTimer = null;
  function showZoom() {
    const bar = document.querySelector(".hym-zoom"); if (!bar) return;
    if (isPlayerOpen()) return;                 // 반주 패널이 열려 있으면 띄우지 않는다
    bar.classList.add("on");
    clearTimeout(_zoomTimer);
    _zoomTimer = setTimeout(hideZoom, 3500);
  }
  function hideZoom() {
    clearTimeout(_zoomTimer);
    const bar = document.querySelector(".hym-zoom"); if (bar) bar.classList.remove("on");
  }
  function isPlayerOpen() { const p = document.querySelector("#hym-player"); return !!(p && p.open); }
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

  // ── 반주 미니플레이어 ────────────────────────────────────────────────
  // 음원은 HymnSource 가 찾아 준다(내 파일 / 유튜브 / 뒷날 MIDI). 여기서는
  // 어떤 음원인지 따지지 않고 caps(할 수 있는 일)만 보고 버튼을 열고 닫는다.
  //  · 박자: 배속으로 바꾼다. preservesPitch 가 true 라 음정은 지켜진다
  //  · 음정: 미디어 요소 하나로는 불가 — MIDI 어댑터가 들어오면 열린다
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
  const LIM = { pitch: 6, tempo: 5 };
  const fmtStep = (n) => (n > 0 ? `+${n}` : `${n}`);
  const rateOf = (step) => 1 + step * 0.05;      // -5…+5 → 0.75 … 1.25배
  const mmss = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  function playerHtml(chapter) {
    const t = loadTune(chapter);
    const src = HymnSource.resolve(chapter, { pitch: t.pitch, role: HymnFolder.role() });
    const ad = src && HymnSource.adapter(src.kind);
    const has = !!ad;
    // 곡마다 할 수 있는 일이 다를 수 있다(폴더에 음정 파일이 있는 곡만 음정 조절).
    // 그래서 resolve 가 알려 준 caps 를 어댑터 기본값보다 우선한다.
    const caps = (src && src.caps) || (ad && ad.caps) || {};
    const online = has && caps.offline === false;
    const state = has
      ? `${src.from ? esc(src.from) : ad.label}${online ? " · 인터넷 필요" : ""}`
      : "음원 없음";
    const pitchOK = has && !!caps.pitch;
    const dis = (ok) => (ok ? "" : " disabled");
    // 반주 / 찬양 — 폴더에 둘 다 있을 때만 고르는 단추를 보여 준다
    // 고를 수 있는 종류 — 폴더가 알려 준 것, 없으면 묶음에 있는 종류를 모은다
    let roles = (src && src.roles) || [];
    if (!roles.length) {
      const inPacks = new Set();
      HymnSource.packs().forEach(pk => {
        if (pk.enabled && pk.role && pk.items && pk.items[String(chapter)]) inPacks.add(pk.role);
      });
      if (inPacks.size > 1) roles = ["mr", "song"].filter(r => inPacks.has(r));
    }
    const roleSeg = roles.length > 1
      ? `<div class="hp-roles">${roles.map(r =>
          `<button class="hp-role${r === src.role ? " on" : ""}" data-role="${r}">${HymnFolder.roleLabel(r)}</button>`).join("")}</div>`
      : "";
    return `<details class="hym-player" id="hym-player">
      <summary><span class="hp-cap">🎹 반주</span><span class="hp-state${online ? " hp-online" : ""}">${state}</span></summary>
      <div class="hp-body">
        <div class="hp-mount" id="hp-mount"></div>
        <div class="hp-seekrow"><span class="hp-t" id="hp-cur">0:00</span>
          <input type="range" class="hp-seek" id="hp-seek" min="0" max="1000" value="0"${dis(has)}><span class="hp-t" id="hp-dur">0:00</span></div>
        <div class="hp-transport">
          <button class="hp-play" id="hp-play"${dis(has)} title="재생">▶</button>
          <button class="hp-loop" id="hp-loop"${dis(has)} title="반복">🔁</button>
          ${roleSeg}
          <button class="hp-src" id="hp-src" title="음원 바꾸기">🎵 음원</button>
        </div>
        <div class="hp-tune">
          <span class="hp-label">음정</span>
          <button class="hp-step" data-k="pitch" data-d="-1"${dis(pitchOK)}>▼</button>
          <b class="hp-val${pitchOK ? "" : " off"}" data-v="pitch">${fmtStep(t.pitch)}</b>
          <button class="hp-step" data-k="pitch" data-d="1"${dis(pitchOK)}>▲</button>
          <span class="hp-label hp-label2">박자</span>
          <button class="hp-step" data-k="tempo" data-d="-1"${dis(has)}>◀</button>
          <b class="hp-val" data-v="tempo">${fmtStep(t.tempo)}</b>
          <button class="hp-step" data-k="tempo" data-d="1"${dis(has)}>▶</button>
        </div>
        <div class="hp-msg" id="hp-msg"></div>
        <button class="help-q" data-help="#hp-note" data-help-title="반주 음원"></button>
        <div class="hp-note help-note" id="hp-note">
          <p><b>박자</b>는 지금도 조절됩니다. 느리게 해도 음이 낮아지지 않고 속도만 바뀝니다.</p>
          <p><b>음정</b>은 소리 파일·유튜브로는 따로 바꿀 수 없습니다. 뒷날 MIDI 반주가 들어오면 열립니다.</p>
          <p>맞춰 두신 값은 <b>곡마다 저장</b>되어 다음에 그 곡을 열면 그대로 있습니다.</p>
          <p>음원은 [🎵 음원]에서 넣고 바꿉니다. 기기의 <b>항상예수께로_찬미</b> 폴더를
             지정해 두면 앱에 담지 않고도 인터넷 없이 씁니다.</p>
          <p><b>반주</b>는 사람 목소리 없는 MR, <b>찬양</b>은 함께 부르는 음원입니다.
             폴더에 둘 다 있으면 여기서 골라 들을 수 있습니다.</p>
        </div>
      </div>
    </details>`;
  }

  // 지금 울리고 있는 반주 하나만 살려 둔다
  let _pl = null;
  function stopPlayer() { if (_pl) { try { _pl.destroy(); } catch (e) {} _pl = null; } }

  // 음정을 바꾸면 다른 파일로 갈아 끼운다 — 듣던 자리에서 이어지게
  async function swapPitch(chapter, pitch) {
    if (!_pl) return;
    const at = _pl.time(), was = _pl.playing();
    const src = HymnSource.resolve(chapter, { pitch, role: HymnFolder.role() });
    const ad = src && HymnSource.adapter(src.kind);
    if (!ad) return;
    const mount = document.querySelector("#hp-mount"); if (!mount) return;
    stopPlayer();
    try {
      _pl = await ad.create(src.ref, mount);
      _pl.setRate(rateOf(loadTune(chapter).tempo));
      _pl.on("tick", () => {});
      _pl.seek(at);
      if (was) _pl.play();
    } catch (e) { _pl = null; }
  }

  function bindPlayer(chapter) {
    const box = document.querySelector("#hym-player"); if (!box) return;
    stopPlayer();
    HelpTip.init(box);
    // 반주 패널이 펼쳐지면 확대 단추는 물러난다 — 둘이 같은 자리에 겹친다
    box.addEventListener("toggle", () => { if (box.open) hideZoom(); });

    const $$ = (s) => box.querySelector(s);
    const msg = (t, bad) => { const m = $$("#hp-msg"); if (m) { m.textContent = t || ""; m.classList.toggle("bad", !!bad); } };

    // 음정·박자 단추 (음원이 없어도 값은 기억해 둔다)
    box.querySelectorAll(".hp-step").forEach(b => b.addEventListener("click", (e) => {
      e.preventDefault();
      if (b.disabled) return;
      const k = b.dataset.k, t = loadTune(chapter);
      t[k] = Math.max(-LIM[k], Math.min(LIM[k], (t[k] || 0) + (+b.dataset.d)));
      saveTune(chapter, t);
      const out = box.querySelector(`.hp-val[data-v="${k}"]`);
      if (out) out.textContent = fmtStep(t[k]);
      if (k === "tempo" && _pl) { _pl.setRate(rateOf(t.tempo)); msg(`박자 ${fmtStep(t.tempo)} (${Math.round(rateOf(t.tempo) * 100)}%)`); }
      // 음정은 실시간 변환이 아니라 "그 음정으로 만들어 둔 파일"로 갈아 끼운다.
      // 듣던 자리와 재생 상태를 그대로 이어 준다.
      if (k === "pitch") { msg(`음정 ${fmtStep(t.pitch)}`); swapPitch(chapter, t.pitch); }
    }));

    // 반주 / 찬양 고르기 — 고른 값은 앱 전체에 남는다
    box.querySelectorAll(".hp-role").forEach(b => b.addEventListener("click", (e) => {
      e.preventDefault();
      HymnFolder.setRole(b.dataset.role);
      stopPlayer();
      show(chapter, _mode);
    }));

    $$("#hp-src").addEventListener("click", (e) => { e.preventDefault(); openSourceSheet(chapter); });

    const src = HymnSource.resolve(chapter);
    const ad = src && HymnSource.adapter(src.kind);
    if (!ad) return;

    const playBtn = $$("#hp-play"), loopBtn = $$("#hp-loop"), seek = $$("#hp-seek");
    let loop = false, seeking = false, ready = false;

    const paint = () => {
      if (!_pl) return;
      playBtn.textContent = _pl.playing() ? "⏸" : "▶";
      const d = _pl.duration(), c = _pl.time();
      $$("#hp-cur").textContent = mmss(c);
      $$("#hp-dur").textContent = mmss(d);
      if (!seeking && d > 0) seek.value = Math.round((c / d) * 1000);
    };

    // 음원은 실제로 누를 때 만든다 — 곡을 넘겨보기만 할 때 인터넷을 쓰지 않도록
    async function ensure() {
      if (_pl) return true;
      msg("불러오는 중…");
      try {
        _pl = await ad.create(src.ref, $$("#hp-mount"));
        _pl.setRate(rateOf(loadTune(chapter).tempo));
        _pl.setLoop(loop);
        _pl.on("tick", paint);
        _pl.on("end", () => { if (!loop) paint(); });
        ready = true; msg(""); paint();
        return true;
      } catch (err) {
        _pl = null;
        msg(err.message || "음원을 열지 못했습니다.", true);
        if (ad.externalUrl) {
          const a = document.createElement("a");
          a.href = ad.externalUrl(src.ref); a.target = "_blank"; a.rel = "noopener";
          a.className = "hp-ext"; a.textContent = "브라우저에서 열기 ↗";
          $$("#hp-msg").appendChild(document.createTextNode(" "));
          $$("#hp-msg").appendChild(a);
        }
        return false;
      }
    }

    playBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!await ensure()) return;
      if (_pl.playing()) _pl.pause(); else _pl.play();
      setTimeout(paint, 120);
    });
    loopBtn.addEventListener("click", (e) => {
      e.preventDefault();
      loop = !loop; loopBtn.classList.toggle("on", loop);
      if (_pl) _pl.setLoop(loop);
    });
    seek.addEventListener("input", () => { seeking = true; });
    seek.addEventListener("change", () => {
      seeking = false;
      if (_pl && ready) { const d = _pl.duration(); if (d > 0) _pl.seek((seek.value / 1000) * d); }
    });
  }

  // ── 음원 관리 ────────────────────────────────────────────────────────
  // 오프라인이 이 앱의 원칙이라, 내 파일을 넣는 길을 맨 위에 둔다.
  // 유튜브 같은 인터넷 음원은 넣어 둔 사람만 쓰고, 넣지 않으면 앱이
  // 인터넷을 건드리는 일 자체가 없다(스크립트도 재생을 누를 때 받는다).
  let _srcChapter = 0;
  function openSourceSheet(chapter) {
    _srcChapter = chapter;
    const ov = document.querySelector("#hymsrc-overlay"); if (!ov) return;
    ov.classList.add("show");
    renderSourceSheet();
  }
  function closeSourceSheet() {
    const ov = document.querySelector("#hymsrc-overlay"); if (ov) ov.classList.remove("show");
  }
  function renderSourceSheet() {
    const body = document.querySelector("#hymsrc-body"); if (!body) return;
    const cur = HymnSource.resolve(_srcChapter);
    const curAd = cur && HymnSource.adapter(cur.kind);
    const packs = HymnSource.packs();
    const list = packs.length ? packs.map(p => {
      const ad = HymnSource.adapter(p.kind);
      const off = ad && ad.caps && ad.caps.offline;
      return `<div class="hs-pack${p.enabled ? " on" : ""}" data-id="${p.id}">
        <label class="hs-chk"><input type="checkbox" ${p.enabled ? "checked" : ""} data-en="${p.id}"></label>
        <span class="hs-main">
          <span class="hs-name">${esc(p.name)}</span>
          <span class="hs-sub">${ad ? esc(ad.label) : esc(p.kind)}${p.role ? " · " + (p.role === "song" ? "찬양" : "반주") : ""} · ${HymnSource.packCount(p)}곡 ·
            <b class="${off ? "hs-off" : "hs-on"}">${off ? "오프라인" : "인터넷 필요"}</b></span>
        </span>
        <button class="hs-mini" data-up="${p.id}" title="위로">▲</button>
        <button class="hs-mini" data-dn="${p.id}" title="아래로">▼</button>
        <button class="hs-mini hs-del" data-del="${p.id}" title="삭제">🗑</button>
      </div>`;
    }).join("") : `<div class="hym-msg" style="padding:12px">아직 넣어 둔 주소록이 없습니다.</div>`;

    body.innerHTML = `
      <div class="hs-cur">
        <b>${_srcChapter}장</b> 지금 음원 —
        ${cur ? esc(cur.from || (curAd ? curAd.label : cur.kind)) : "<span class=\"hs-none\">없음</span>"}
        ${cur && cur.pick ? `<button class="hs-mini" id="hs-unpick">이 곡 지정 해제</button>` : ""}
      </div>

      ${candHtml(_srcChapter, cur)}

      <div class="hs-sec">① 내 기기 폴더 쓰기 <b class="hs-off">오프라인 · 권장</b><button class="help-q" data-help="#hsn-folder" data-help-title="내 기기 폴더 쓰기"></button></div>
      <div class="hs-guide help-note" id="hsn-folder">
        <p>음원을 앱에 담지 않고 <b>${esc(HymnFolder.FOLDER)}</b> 폴더에서 바로 읽습니다.
          759곡이면 2GB가 넘어 앱에 담을 수 없고, 앱을 다시 깔아도 폴더는 남습니다.</p>
        <p>폴더 안에 <b>반주</b>·<b>찬양</b> 두 칸을 두면 골라 들을 수 있습니다.</p>
        <p>파일 이름은 번호만 맞으면 됩니다 — <code>444.mp3</code>, <code>001.mp3</code>,
          <code>444 주 예수.mp3</code></p>
        <p>같은 곡을 <code>444_pitch_-2_tempo_0_pitched.mp3</code> 처럼 음정별로 넣어 두면
          <b>음정 조절</b>이 열립니다.</p>
      </div>
      <div class="hs-folder">
        <span class="hs-fstat">${HymnFolder.isLinked()
          ? `반주 <b>${HymnFolder.count("mr")}</b>곡 · 찬양 <b>${HymnFolder.count("song")}</b>곡`
          : "<span class=\"hs-none\">아직 폴더를 읽지 않았습니다</span>"}</span>
        <button class="hs-btn main" id="hs-link">${HymnFolder.isCap() ? "📁 폴더 읽기" : "📁 폴더 고르기"}</button>
        ${HymnFolder.isLinked() ? `<button class="hs-mini" id="hs-rescan">다시 읽기</button>
          <button class="hs-mini hs-del" id="hs-unlink">지우기</button>` : ""}
      </div>

      <div class="hs-sec">② 앱 안에 넣어 두기 <b class="hs-off">오프라인</b><button class="help-q" data-help="#hsn-inapp" data-help-title="앱 안에 넣어 두기"></button></div>
      <div class="hs-guide help-note" id="hsn-inapp">
        <p>몇 곡만 쓸 때 좋습니다. 폴더를 옮기지 않아도 되지만 앱을 지우면 함께 지워집니다.</p>
        <p>파일 이름에 곡 번호가 들어 있으면 자동으로 짝지어집니다 —
          <code>305.mp3</code>, <code>305 주 예수.mp3</code>, <code>hymn_305.m4a</code></p>
      </div>
      <div class="hs-btns">
        <button class="hs-btn main" id="hs-folder">📁 폴더 통째로</button>
        <button class="hs-btn" id="hs-files">🎵 파일 고르기</button>
        <button class="hs-btn" id="hs-one">이 곡에 하나만</button>
      </div>
      <input type="file" id="hs-folder-input" webkitdirectory multiple hidden>
      <input type="file" id="hs-files-input" accept="audio/*" multiple hidden>
      <input type="file" id="hs-one-input" accept="audio/*" hidden>

      <div class="hs-sec">③ 인터넷 음원 주소록 넣기 <b class="hs-on">인터넷 필요</b><button class="help-q" data-help="#hsn-json" data-help-title="음원 주소록이란"></button></div>
      <div class="hs-guide">소리 파일이 아니라, <b>곡 번호마다 어디에 음원이 있는지 적어 둔 목록</b>입니다.</div>
      <div class="hs-guide help-note" id="hsn-json">
        <p>①·②는 소리 파일 자체를 넣지만, 여기는 <b>주소록</b>만 넣습니다.
          그래서 파일이 아주 작고(수십 KB), 재생할 때 인터넷이 필요합니다.</p>
        <p>이렇게 생긴 <code>.json</code> 파일입니다 —</p>
        <p><code>1장 → oqCZ74Lmmhw</code><br>
           <code>444장 → MPA7g-3MCw8</code></p>
        <p>주소록에 <b>반주</b>·<b>찬양</b> 구분이 적혀 있으면 그대로 따릅니다.</p>
        <p>인터넷 없이 쓰시려면 ①의 <b>기기 폴더</b>를 쓰세요. 주소록은 폴더에 없는 곡을
          급히 찾을 때 받쳐 주는 용도입니다.</p>
      </div>
      <div class="hs-btns">
        <button class="hs-btn" id="hs-json">📄 주소록 파일 고르기</button>
      </div>
      <input type="file" id="hs-json-input" accept=".json,application/json" hidden>

      <div class="hs-sec">넣어 둔 주소록 <span class="hs-guide2">위에 있는 것부터 먼저 씁니다</span></div>
      ${list}`;

    // ── 이어 주기 ──
    HelpTip.init(body);
    const q = (s) => body.querySelector(s);
    const pick = (inputSel, handler) => { const i = q(inputSel); i.value = ""; i.onchange = (e) => handler([...e.target.files]); i.click(); };

    if (q("#hs-link")) q("#hs-link").onclick = async () => {
      try { await HymnFolder.link(true); toast(`폴더를 읽었습니다 — 반주 ${HymnFolder.count("mr")}곡 · 찬양 ${HymnFolder.count("song")}곡`); refreshAfterSource(); }
      catch (e) { if (e && e.name !== "AbortError") alert("폴더를 읽지 못했습니다.\n\n" + (e.message || e)); }
    };
    if (q("#hs-rescan")) q("#hs-rescan").onclick = async () => {
      try { await HymnFolder.scan(); toast(`다시 읽었습니다 — 반주 ${HymnFolder.count("mr")}곡 · 찬양 ${HymnFolder.count("song")}곡`); refreshAfterSource(); }
      catch (e) { alert("다시 읽지 못했습니다.\n\n" + (e.message || e)); }
    };
    if (q("#hs-unlink")) q("#hs-unlink").onclick = () => { HymnFolder.clear(); refreshAfterSource(); };
    q("#hs-folder").onclick = () => pick("#hs-folder-input", importAudioFiles);
    q("#hs-files").onclick = () => pick("#hs-files-input", importAudioFiles);
    q("#hs-one").onclick = () => pick("#hs-one-input", (fs) => importOne(fs[0]));
    q("#hs-json").onclick = () => pick("#hs-json-input", (fs) => importJson(fs[0]));
    if (q("#hs-unpick")) q("#hs-unpick").onclick = () => { HymnSource.setPick(_srcChapter, null); refreshAfterSource(); };

    const cands = HymnSource.candidates(_srcChapter);
    body.querySelectorAll("[data-use]").forEach(b => b.onclick = () => {
      const c = cands[+b.dataset.use]; if (!c) return;
      HymnSource.setPick(_srcChapter, { kind: c.kind, ref: c.ref, name: c.from });
      toast(`${_srcChapter}장 음원을 「${c.from}」(으)로 정했습니다`);
      refreshAfterSource();
    });
    body.querySelectorAll("[data-en]").forEach(c => c.onchange = () => { HymnSource.setPackEnabled(c.dataset.en, c.checked); refreshAfterSource(); });
    body.querySelectorAll("[data-up]").forEach(b => b.onclick = () => { HymnSource.movePack(b.dataset.up, -1); refreshAfterSource(); });
    body.querySelectorAll("[data-dn]").forEach(b => b.onclick = () => { HymnSource.movePack(b.dataset.dn, 1); refreshAfterSource(); });
    body.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      const p = HymnSource.packs().find(x => x.id === b.dataset.del);
      if (p && confirm(`「${p.name}」 주소록을 지울까요?\n(넣어 둔 소리 파일은 지워지지 않습니다)`)) { HymnSource.removePack(b.dataset.del); refreshAfterSource(); }
    });
  }
  // 이 곡에 쓸 수 있는 음원을 모두 보여 주고 직접 고르게 한다.
  // 오프라인이 없으면 인터넷 음원이라도 골라 들을 수 있어야 한다.
  function candHtml(chapter, cur) {
    const list = HymnSource.candidates(chapter);
    if (!list.length) return "";
    const same = (c) => cur && c.kind === cur.kind && c.ref === cur.ref;
    const rows = list.map((c, i) => {
      const ad = HymnSource.adapter(c.kind);
      const off = c.caps && c.caps.offline;
      const role = c.role ? (c.role === "song" ? "찬양" : "반주") : "";
      return `<div class="hs-cand${same(c) ? " on" : ""}">
        <span class="hs-main">
          <span class="hs-name">${esc(c.from || ad.label)}${c.off ? " <i>(꺼 둠)</i>" : ""}</span>
          <span class="hs-sub">${role ? role + " · " : ""}<b class="${off ? "hs-off" : "hs-on"}">${off ? "오프라인" : "인터넷 필요"}</b></span>
        </span>
        ${same(c) ? `<span class="hs-using">쓰는 중</span>`
                  : `<button class="hs-mini" data-use="${i}">이걸로</button>`}
      </div>`;
    }).join("");
    return `<div class="hs-sec">이 곡에 쓸 수 있는 음원
        <button class="help-q" data-help="#hsn-cand" data-help-title="음원 고르기"></button></div>
      <div class="hs-guide help-note" id="hsn-cand">
        <p>기기 폴더와 넣어 둔 주소록에서 이 곡을 가진 음원을 모두 모았습니다.</p>
        <p>평소에는 <b>오프라인(폴더)</b>을 먼저 쓰지만, 폴더에 없으면 <b>인터넷 음원</b>으로
          넘어갑니다. 여기서 직접 고르면 그 곡에만 계속 적용됩니다.</p>
      </div>
      ${rows}`;
  }

  // 음원이 바뀌면 시트와 플레이어를 함께 다시 그린다
  function refreshAfterSource() {
    renderSourceSheet();
    if (_cur) show(_cur, _mode);
  }

  // 파일 이름에서 곡 번호 뽑기 — "305.mp3", "305 주 예수.mp3", "hymn_305.m4a"
  function numFromName(name) {
    const base = String(name).replace(/\.[^.]+$/, "");
    const m = base.match(/(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/);
    return m ? +m[1] : null;
  }
  async function importAudioFiles(files) {
    const audio = files.filter(f => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|ogg|wav|opus)$/i.test(f.name));
    if (!audio.length) { toast("소리 파일을 찾지 못했습니다"); return; }
    const items = {}; let ok = 0, skip = 0;
    for (const f of audio) {
      const n = numFromName(f.name);
      if (!n) { skip++; continue; }
      const id = `h${n}`;
      await HymnSource.Audio.save(id, f);
      items[String(n)] = `file:${id}`; ok++;
    }
    if (!ok) { toast("파일 이름에서 곡 번호를 찾지 못했습니다"); return; }
    // 이미 있는 "내 반주 파일" 묶음에 합친다 — 여러 번 나눠 넣어도 하나로
    const mine = HymnSource.packs().find(p => p.kind === "audio" && p.name === MY_PACK);
    if (mine) {
      Object.assign(mine.items, items);
      HymnSource.savePacks(HymnSource.packs().map(p => (p.id === mine.id ? mine : p)));
    } else {
      HymnSource.addPack({ name: MY_PACK, kind: "audio", items });
    }
    toast(`${ok}곡 넣었습니다${skip ? ` (번호 못 찾음 ${skip})` : ""}`);
    refreshAfterSource();
  }
  const MY_PACK = "내 반주 파일";
  async function importOne(file) {
    if (!file) return;
    const id = `h${_srcChapter}`;
    await HymnSource.Audio.save(id, file);
    HymnSource.setPick(_srcChapter, { kind: "audio", ref: `file:${id}`, name: file.name });
    toast(`${_srcChapter}장에 넣었습니다`);
    refreshAfterSource();
  }
  async function importJson(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const pack = HymnSource.parsePack(data, file.name.replace(/\.json$/i, ""));
      const ad = HymnSource.adapter(pack.kind);
      if (!ad) throw new Error(`모르는 음원 종류입니다: ${pack.kind}`);
      HymnSource.addPack(pack);
      toast(`「${pack.name}」 ${Object.keys(pack.items).length}곡 가져왔습니다`);
      refreshAfterSource();
    } catch (e) {
      alert("가져오지 못했습니다.\n\n" + (e.message || e));
    }
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
    const sx = $("#hymsrc-close"); if (sx) sx.addEventListener("click", closeSourceSheet);
    const so = $("#hymsrc-overlay");
    if (so) so.addEventListener("click", e => { if (e.target === so) closeSourceSheet(); });
  }

  return { init, renderList, show, close, hasAny, listLyrics, listScores, openSourceSheet };
})();
