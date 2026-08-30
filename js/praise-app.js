// ============================================================================
// praise-app — 매일찬양 UI (praise.html 전용)
// 화면: 오늘의 찬양(새벽 큐·연속재생) · 찬양 서재(검색·추가) · 달력
// 재생: mp3 연속재생 + 한곡반복(각인) / 유튜브 임베드 + 앱으로 열기
// ============================================================================

(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let tab = "today";
  let calBase = new Date(), _calPicked = null;
  let editingId = null, _pendingAudio = null;
  let libFilter = "", libQuery = "";

  function applyScheme() {
    let s = "dark";
    try { s = localStorage.getItem("bible-color-scheme") || "light"; } catch (e) {}
    const eff = s === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : s;
    document.documentElement.dataset.theme = eff;
    syncStatusBar(eff);
  }

  // 시트를 열 때마다 z-index를 올린다 — 같은 z-index면 DOM 순서가 위아래를 정해
  // 목록창이 곡 설정창을 덮어 버리던 문제를 원천 차단
  let _zTop = 20;
  function showSheet(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.zIndex = ++_zTop;
    el.classList.add("show");
  }
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ── 플레이어 (mp3) ───────────────────────────────────────────────────
  const audio = new Audio();
  audio.preload = "auto";
  let playlist = [], playIdx = -1;

  // ── 듣기 방식 — 한 버튼으로 네 가지를 돌려 쓴다(상태가 이모지로 보인다) ──
  //  ➡️ 순서대로(목록 끝나면 멈춤) · 🔁 전체반복 · 🔂 한곡반복 · 🔀 셔플
  const MODES = [
    { key: "order",     ico: "➡️", label: "순서대로" },
    { key: "repeatAll", ico: "🔁", label: "전체반복" },
    { key: "repeatOne", ico: "🔂", label: "한곡반복" },
    { key: "shuffle",   ico: "🔀", label: "셔플" }
  ];
  const MODE_KEY = "bible-praise-playmode";
  let playMode = "repeatAll";      // 기본을 전체반복으로 — '연속듣기'가 끊기지 않게
  try { const m = localStorage.getItem(MODE_KEY); if (m && MODES.some(x => x.key === m)) playMode = m; } catch (e) {}
  const _mode = () => MODES.find(m => m.key === playMode) || MODES[1];
  function cycleMode() {
    const i = MODES.findIndex(m => m.key === playMode);
    playMode = MODES[(i + 1) % MODES.length].key;
    try { localStorage.setItem(MODE_KEY, playMode); } catch (e) {}
    renderPlayer();
    toast(`${_mode().ico} ${_mode().label}`);
  }

  async function playList(ids, start, shuffle) {
    let list = ids.filter(id => { const it = _byId(id); return it && it.hasAudio; });
    if (!list.length) { toast("재생할 음원이 없습니다 (유튜브 찬양은 상세에서 재생)"); return; }
    if (shuffle) {
      playMode = "shuffle";
      try { localStorage.setItem(MODE_KEY, playMode); } catch (e) {}
    }
    if (playMode === "shuffle" && !start) list = _shuffled(list);
    playlist = list;
    playIdx = Math.max(0, playlist.indexOf(start || playlist[0]));
    _failStreak = 0;
    await _playCurrent();
  }
  function _shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // 깨진 음원이 하나 있다고 재생이 멈춰 서지 않게 — 다음 곡으로 넘어가되,
  // 목록이 통째로 깨졌을 땐 무한히 돌지 않도록 한 바퀴에서 멈춘다.
  let _failStreak = 0;
  async function _playCurrent() {
    const id = playlist[playIdx];
    const url = await PraiseAudio.getURL(id);
    if (!url) { _autoAdvanceOnFailure(); return; }
    if (audio.src && audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
    audio.src = url;
    try { await audio.play(); _failStreak = 0; }
    catch (e) { renderPlayer(); return; }      // 브라우저가 막은 것 — ▶를 누르면 이어진다
    PraiseStore.logListen(id);
    renderPlayer();
    _syncMediaSession();
    if (tab === "today") renderToday();
  }
  function _autoAdvanceOnFailure() {
    if (++_failStreak >= playlist.length) {
      _failStreak = 0;
      toast("재생할 수 있는 음원을 찾지 못했습니다");
      audio.pause(); renderPlayer(); return;
    }
    _step(1, true);
  }

  // d: +1 다음 / -1 이전 · auto: 곡이 저절로 끝나서 넘어가는 경우
  function _step(d, auto) {
    if (!playlist.length) return;
    if (auto && playMode === "repeatOne") { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    const last = playIdx + d >= playlist.length, first = playIdx + d < 0;
    if (last || first) {
      // 순서대로: 자동일 때만 멈춘다. 전체반복·셔플·한곡반복은 계속 돈다.
      if (auto && playMode === "order") { audio.pause(); renderPlayer(); return; }
      if (playMode === "shuffle" && last) playlist = _shuffled(playlist);   // 한 바퀴 돌면 새로 섞는다
    }
    playIdx = (playIdx + d + playlist.length) % playlist.length;
    _playCurrent();
  }
  function _next(auto) { _step(1, auto); }
  function _prev() { _step(-1, false); }
  audio.addEventListener("ended", () => _next(true));
  audio.addEventListener("play", renderPlayer);
  audio.addEventListener("pause", renderPlayer);
  // 파일이 깨졌거나 디코딩에 실패해도 멈춰 서지 않는다 (연속듣기가 끊기던 주원인)
  audio.addEventListener("error", () => { if (playlist.length) _autoAdvanceOnFailure(); });
  audio.addEventListener("timeupdate", _renderSeek);
  audio.addEventListener("loadedmetadata", _renderSeek);

  // 잠금화면·이어폰 버튼으로도 조절되게 (안드로이드에서 재생이 잘 끊기지 않는다)
  function _syncMediaSession() {
    const ms = navigator.mediaSession; if (!ms) return;
    const it = _byId(playlist[playIdx]); if (!it) return;
    try {
      ms.metadata = new MediaMetadata({ title: it.title || "찬양", artist: it.performer || it.composer || "", album: it.category || "매일찬양" });
      ms.setActionHandler("play", () => audio.play().catch(() => {}));
      ms.setActionHandler("pause", () => audio.pause());
      ms.setActionHandler("previoustrack", () => _prev());
      ms.setActionHandler("nexttrack", () => _next(false));
    } catch (e) {}
  }

  const _mmss = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };
  let _seeking = false;
  // 오른쪽 시간은 눌러서 [전체시간 ↔ 남은시간]을 오간다
  const DURMODE_KEY = "bible-praise-durmode";
  let _showLeft = false;
  try { _showLeft = localStorage.getItem(DURMODE_KEY) === "left"; } catch (e) {}
  function toggleDurMode() {
    _showLeft = !_showLeft;
    try { localStorage.setItem(DURMODE_KEY, _showLeft ? "left" : "total"); } catch (e) {}
    _renderSeek();
  }
  function _renderSeek() {
    if (_seeking) return;
    const sk = $("#pl-seek"); if (!sk) return;
    const d = audio.duration;
    sk.value = (isFinite(d) && d > 0) ? Math.round((audio.currentTime / d) * 1000) : 0;
    $("#pl-cur").textContent = _mmss(audio.currentTime);
    const dur = $("#pl-dur");
    if (!isFinite(d)) { dur.textContent = "0:00"; return; }
    dur.textContent = _showLeft ? "-" + _mmss(Math.max(0, d - audio.currentTime)) : _mmss(d);
    dur.title = _showLeft ? "남은시간 (눌러서 전체시간)" : "전체시간 (눌러서 남은시간)";
  }

  function renderPlayer() {
    const bar = $("#player");
    const id = playlist[playIdx];
    const it = id && _byId(id);
    if (!it) {
      bar.classList.remove("show");
      document.body.classList.remove("player-on");
      _syncRowPlayIcons(); return;
    }
    bar.classList.add("show");
    document.body.classList.add("player-on");
    _saveRelay();
    // 플레이어 실제 높이를 재서 알려 준다 — 열려 있는 시트가 그만큼 바닥을
    // 띄워 [저장]·[공유] 같은 아래쪽 버튼이 가리지 않게 (픽셀 짐작 금지)
    requestAnimationFrame(() => {
      const h = bar.offsetHeight;
      if (h) document.documentElement.style.setProperty("--player-h", h + "px");
    });
    $("#pl-title").textContent = it.title;
    $("#pl-toggle").textContent = audio.paused ? "▶" : "⏸";
    $("#pl-mode").textContent = _mode().ico;
    $("#pl-mode").title = `듣기 방식: ${_mode().label} (눌러서 바꾸기)`;
    $("#pl-pos").textContent = `${playIdx + 1}/${playlist.length}`;
    _renderSeek();
    _syncRowPlayIcons();
  }
  // 목록의 ▶/⏸ 아이콘을 현재 재생 상태에 맞춘다 (전체 재렌더 없이)
  function _syncRowPlayIcons() {
    const cur = !audio.paused ? playlist[playIdx] : null;
    document.querySelectorAll("[data-play]").forEach(b => { b.textContent = b.dataset.play === cur ? "⏸" : "▶"; });
    const pp = document.getElementById("plan-play");
    if (pp && _planTarget) pp.textContent = (cur === _planTarget) ? "⏸" : "▶";
  }
  function closePlayer() {
    audio.pause();
    if (audio.src && audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
    audio.removeAttribute("src");
    playlist = []; playIdx = -1;
    document.body.classList.remove("player-on");
    if (typeof PlayRelay !== "undefined") PlayRelay.clear();
    _sleepStop();
    renderPlayer();
  }

  // ── 🌙 수면 타이머 — 정해 둔 시간 뒤 볼륨을 서서히 낮추며 멈춘다 ──────────
  //  재생 위치가 아니라 실제 흐른 시간으로 잰다(음악 앱들의 일반적인 방식).
  //  버튼을 누를 때마다 꺼짐→15→30→60→꺼짐 순으로 돈다.
  const SLEEP_PRESETS = [0, 15, 30, 60];   // 분. 0 = 꺼짐
  const SLEEP_FADE_SEC = 12;               // 끝나기 전 이만큼 서서히 볼륨을 낮춘다
  let sleepMin = 0, _sleepEndAt = 0, _sleepTick = null;

  function _sleepStop() {
    if (_sleepTick) { clearInterval(_sleepTick); _sleepTick = null; }
    sleepMin = 0; _sleepEndAt = 0;
    audio.volume = 1;
    _renderSleepBtn();
  }
  function _sleepFire() {
    audio.pause();
    _sleepStop();
    toast("🌙 수면 타이머 — 재생을 멈췄습니다");
  }
  function _sleepTickFn() {
    const left = _sleepEndAt - Date.now();
    if (left <= 0) { _sleepFire(); return; }
    if (left <= SLEEP_FADE_SEC * 1000) audio.volume = Math.max(0, left / (SLEEP_FADE_SEC * 1000));
    _renderSleepBtn();
  }
  function _renderSleepBtn() {
    const b = $("#pl-sleep"); if (!b) return;
    if (!sleepMin) { b.textContent = "🌙"; b.title = "수면 타이머 (꺼짐 — 눌러서 설정)"; b.classList.remove("on"); return; }
    b.classList.add("on");
    const m = Math.max(1, Math.ceil((_sleepEndAt - Date.now()) / 60000));
    b.textContent = m + "분";
    b.title = `수면 타이머: ${m}분 뒤 정지 (눌러서 바꾸기)`;
  }
  function cycleSleep() {
    const i = SLEEP_PRESETS.indexOf(sleepMin);
    sleepMin = SLEEP_PRESETS[(i + 1) % SLEEP_PRESETS.length];
    if (_sleepTick) { clearInterval(_sleepTick); _sleepTick = null; }
    audio.volume = 1;
    if (!sleepMin) { _sleepEndAt = 0; _renderSleepBtn(); toast("수면 타이머를 껐습니다"); return; }
    _sleepEndAt = Date.now() + sleepMin * 60000;
    _sleepTick = setInterval(_sleepTickFn, 1000);
    _renderSleepBtn();
    toast(`🌙 ${sleepMin}분 뒤 재생을 멈춥니다`);
  }

  // ── 페이지를 옮겨도 음악이 이어지는 느낌 (js/play-relay.js) ───────────
  //  이 페이지는 SPA가 아니라서, 넘어가는 순간 이 audio도 함께 사라진다.
  //  대신 재생 목록·위치·재생 여부를 짧게 넘겨 다음 화면에서 이어 튼다.
  function _saveRelay() {
    if (typeof PlayRelay === "undefined") return;
    if (!playlist.length) { PlayRelay.clear(); return; }
    PlayRelay.save({ ids: playlist, idx: playIdx, pos: audio.currentTime || 0, playing: !audio.paused, mode: playMode, source: "praise" });
  }
  // 다른 화면(성경읽기 등)에서 이어 듣던 것을 이 페이지가 열리며 넘겨받는다
  async function _adoptRelay() {
    if (typeof PlayRelay === "undefined") return false;
    const r = PlayRelay.load();
    if (!r || playlist.length) return false;   // 이미 뭔가 재생 중이면 건드리지 않는다
    playlist = r.ids;
    playIdx = Math.min(Math.max(r.idx || 0, 0), playlist.length - 1);
    if (r.mode && MODES.some(m => m.key === r.mode)) playMode = r.mode;
    const url = await PraiseAudio.getURL(playlist[playIdx]);
    if (!url) { playlist = []; playIdx = -1; return false; }
    audio.src = url;
    audio.addEventListener("loadedmetadata", () => { audio.currentTime = r.pos || 0; }, { once: true });
    if (r.playing) { try { await audio.play(); } catch (e) {} }
    renderPlayer();
    _syncMediaSession();
    return true;
  }
  window.addEventListener("pagehide", _saveRelay);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") _saveRelay(); });

  // ── 듣기 묶음 접기·펼치기 ────────────────────────────────────────────
  //  채널로 듣기는 펼친 채로, 분류·태그로 듣기는 접힌 채로 시작한다.
  //  한 번이라도 손으로 접거나 펴면 그 선택을 기억한다.
  const FOLD_KEY = "bible-praise-fold";
  function foldMap() { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function isOpen(key, defOpen) { const m = foldMap(); return key in m ? !!m[key] : defOpen; }
  function setOpen(key, open) {
    const m = foldMap(); m[key] = !!open;
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function _foldSection(key, title, hint, cards, defOpen) {
    const open = isOpen(key, defOpen);
    return `<div class="fold-sec${open ? "" : " folded"}" data-foldsec="${key}">
      <div class="slot-head fold-head" data-fold="${key}" style="margin-top:18px">
        <span class="fold-tri">▼</span> ${title}
        ${hint ? `<span class="slot-cnt">${hint}</span>` : ""}
      </div>
      <div class="fold-body"><div class="ch-grid">${cards}</div></div>
    </div>`;
  }

  const _byId = (id) => PraiseStore.items().find(x => x.id === id);

  // ── 탭 ───────────────────────────────────────────────────────────────
  function setTab(t) {
    tab = t;
    document.querySelectorAll(".tabbar button[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("show", p.id === "page-" + t));
    // 찬미가는 내가 담는 목록이 아니라 읽어 오는 책이라 ＋(음원 추가)가 어울리지 않는다
    const fab = $("#add-btn"); if (fab) fab.style.display = (t === "hymnal") ? "none" : "";
    render();
  }
  function render() {
    if (tab === "today") renderToday();
    else if (tab === "lib") renderLib();
    else if (tab === "cal") renderCal();
    // 찬미가는 성경 DB 그릇을 읽어 오므로 비동기다 — render()는 기다리지 않는다
    else if (tab === "hymnal" && typeof Hymnal !== "undefined") Hymnal.renderList();
  }

  // ── ① 오늘의 찬양 ────────────────────────────────────────────────────
  function _rowHtml(it, opts) {
    const o = opts || {};
    const listened = (PraiseStore.log()[PraiseStore.today()] || []).includes(it.id);
    const media = it.hasAudio ? `<span class="pbadge">mp3</span>` : "";
    const yt = it.youtube ? `<span class="pbadge yt">YT</span>` : "";
    const playing = !audio.paused && playlist[playIdx] === it.id;
    return `<div class="praise-row${listened && o.mark ? " done" : ""}" data-open="${it.id}">
      <div class="pr-main">
        <div class="pr-title">${it.memorized ? "✅ " : ""}${esc(it.title)} ${media}${yt}${it.favorite ? " ♥" : ""}</div>
        <div class="pr-sub">${esc(PraiseStore.catsOf(it).join("·"))}${it.performer ? " · " + esc(it.performer) : ""}${it.verseRef ? " · 📖" + esc(it.verseRef) : ""}</div>
      </div>
      ${it.hasAudio ? `<button class="rowbtn play" data-play="${it.id}" title="이 곡부터 연속재생">${playing ? "⏸" : "▶"}</button>` : ""}
      ${o.planBtn ? `<button class="rowbtn moon${o.planned ? " on" : ""}" data-plan="${it.id}" title="새벽에 담기">🌙</button>` : ""}
      <button class="rowbtn del" data-del="${it.id}" title="삭제">🗑</button>
    </div>`;
  }

  function _channelCard(name, ids, chKey) {
    const n = ids.filter(id => { const it = _byId(id); return it && it.hasAudio; }).length;
    return `<div class="ch-card${n ? "" : " empty"}" data-ch="${chKey}">
      <div class="ch-name">${name}</div>
      <div class="ch-foot">
        <span class="ch-sub">${n}곡</span>
        <span class="ch-btns">
          <button class="ch-play" data-chplay="${chKey}" ${n ? "" : "disabled"}>▶</button>
          <button class="ch-play" data-chshuf="${chKey}" ${n ? "" : "disabled"}>🔀</button>
        </span>
      </div></div>`;
  }

  function renderToday() {
    const box = $("#today-body");
    const todayIds = PraiseStore.planFor(PraiseStore.today());
    const tomIds = PraiseStore.planFor(PraiseStore.tomorrow());
    const todayItems = todayIds.map(_byId).filter(Boolean);
    const tomItems = tomIds.map(_byId).filter(Boolean);

    // ① 오늘 새벽 찬양이 맨 위 — 아침에 열자마자 바로 보이도록
    let html = `<div class="slot-head">🌅 오늘 새벽 찬양 <span class="slot-cnt">${todayItems.length}</span>
      ${todayItems.some(x => x.hasAudio) ? `<button class="play-all" id="play-today">▶ 연속재생</button>` : ""}</div>`;
    html += todayItems.map(it => _rowHtml(it, { mark: true })).join("") ||
      `<div class="empty-line">예약된 찬양이 없습니다 — 서재에서 🌙 를 눌러 [오늘]에 담아 보세요</div>`;

    // ② 가운데: 채널 · 분류 · 태그로 듣기
    const chCards = PraiseStore.CHANNELS.map(ch =>
      _channelCard(ch.name, PraiseStore.channelSongs(ch.key).map(x => x.id), "ch:" + ch.key)).join("");
    html += _foldSection("ch", "🎧 채널로 듣기", "곡의 🌙에서 채널을 고르세요", chCards, true);
    const catCards = PraiseStore.CATEGORIES.map(cat => {
      const ids = PraiseStore.items().filter(x => PraiseStore.inCat(x, cat)).map(x => x.id);
      return ids.length ? _channelCard(cat, ids, "cat:" + cat) : "";
    }).join("");
    if (catCards) html += _foldSection("cat", "📁 분류로 듣기", "", catCards, false);
    const tagCards = PraiseStore.userTags().slice(0, 12)
      .map(t => _channelCard("#" + t.tag, PraiseStore.tagSongs(t.tag).map(x => x.id), "tag:" + t.tag)).join("");
    if (tagCards) html += _foldSection("tag", "🏷 태그로 듣기", "폴더 이름·직접 넣은 태그", tagCards, false);

    // ③ 내일 준비·다가오는 예약은 맨 아래
    html += `<div class="slot-head" style="margin-top:18px">🌙 내일 새벽 준비 <span class="slot-cnt">${tomItems.length}</span></div>`;
    html += tomItems.map(it => _rowHtml(it, { planBtn: true, planned: true })).join("") ||
      `<div class="empty-line">서재에서 🌙 를 눌러 담아 두세요 (날짜도 고를 수 있어요)</div>`;
    // 모레 이후 예약도 한눈에
    const plan = PraiseStore.plan();
    const later = Object.keys(plan).filter(d => d > PraiseStore.tomorrow() && plan[d].length).sort();
    if (later.length) {
      html += `<div class="slot-head" style="margin-top:18px">📆 다가오는 예약</div>`;
      html += later.map(d => {
        const names = plan[d].map(id => { const x = _byId(id); return x ? x.title : null; }).filter(Boolean);
        return `<div class="praise-row" style="cursor:default"><div class="pr-main">
          <div class="pr-title">${d.replace(/-/g, ".")} <span class="pbadge">${names.length}곡</span></div>
          <div class="pr-sub">${esc(names.slice(0, 3).join(", "))}${names.length > 3 ? "…" : ""}</div></div></div>`;
      }).join("");
    }
    box.innerHTML = html;
    const pa = $("#play-today");
    if (pa) pa.addEventListener("click", (e) => { e.stopPropagation(); playList(todayIds); });
    const chIds = (key) => key.startsWith("ch:") ? PraiseStore.channelSongs(key.slice(3)).map(x => x.id)
      : key.startsWith("tag:") ? PraiseStore.tagSongs(key.slice(4)).map(x => x.id)
      : PraiseStore.items().filter(x => PraiseStore.inCat(x, key.slice(4))).map(x => x.id);
    box.querySelectorAll("[data-fold]").forEach(h => h.addEventListener("click", () => {
      const sec = h.closest(".fold-sec");
      const open = sec.classList.toggle("folded") === false;
      setOpen(h.dataset.fold, open);
    }));
    box.querySelectorAll("[data-chplay]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); playList(chIds(b.dataset.chplay), null, false); }));
    box.querySelectorAll("[data-chshuf]").forEach(b => b.addEventListener("click", (e) => { e.stopPropagation(); playList(chIds(b.dataset.chshuf), null, true); }));
    // 카드를 누르면 그 묶음의 곡 목록이 열린다 (▶·🔀 버튼은 위에서 전파를 끊음)
    box.querySelectorAll(".ch-card").forEach(c => c.addEventListener("click", () => openChannelList(c.dataset.ch)));
    _bindRows(box);
  }

  // 고정 영역 높이 실측 → sticky 기준점 (헤더·칩 줄수가 기기마다 다르다)
  function _syncStickyTops() {
    const hdr = document.querySelector("header");
    const st = document.getElementById("lib-sticky");
    if (!hdr || !st) return;
    const hh = hdr.offsetHeight;
    // 창 전환·회전 중 순간적으로 폭이 0이 되면 헤더가 세로로 늘어나 엉뚱한 값이 잡힌다 — 무시
    if (!hh || hh > window.innerHeight * 0.3) return;
    document.documentElement.style.setProperty("--hdr-h", hh + "px");
    document.documentElement.style.setProperty("--lib-top", (hh + st.offsetHeight) + "px");
  }

  // ── ② 찬양 서재 ──────────────────────────────────────────────────────
  function renderLib() {
    const box = $("#lib-body");
    const chips = ["전체", ...PraiseStore.CATEGORIES, "♥", "✅ 외움"];
    $("#lib-chips").innerHTML = chips.map(c =>
      `<button class="chip${(libFilter || "전체") === c ? " on" : ""}" data-chip="${c}">${c}</button>`).join("");
    $("#lib-chips").querySelectorAll("[data-chip]").forEach(b => b.addEventListener("click", () => {
      libFilter = b.dataset.chip === "전체" ? "" : b.dataset.chip; renderLib();
    }));

    let arr = PraiseStore.items();
    if (libFilter === "♥") arr = arr.filter(x => x.favorite);
    else if (libFilter === "✅ 외움") arr = arr.filter(x => x.memorized);
    else if (libFilter) arr = arr.filter(x => PraiseStore.inCat(x, libFilter));
    if (libQuery) {
      const q = libQuery.toLowerCase();
      arr = arr.filter(x => [x.title, x.composer, x.lyricist, x.performer, x.verseRef, (x.tags || []).join(" "), x.lyrics]
        .some(f => String(f || "").toLowerCase().includes(q)));
    }
    const tomIds = PraiseStore.planFor(PraiseStore.tomorrow());
    let html = "";
    for (const cat of PraiseStore.CATEGORIES) {
      const list = arr.filter(x => (PraiseStore.catsOf(x)[0] || "기타") === cat);   // 대표 분류로만 묶는다
      if (!list.length) continue;
      html += `<div class="grp"><div class="grp-head">${cat} <span class="slot-cnt">${list.length}</span></div>`;
      html += list.map(it => _rowHtml(it, { planBtn: true, planned: tomIds.includes(it.id) })).join("");
      html += `</div>`;
    }
    box.innerHTML = html || `<div class="empty-line" style="margin-top:40px">${libQuery || libFilter ? "조건에 맞는 찬양이 없습니다"
        : "아직 담아 둔 찬양이 없습니다.<br><br>여러 곡을 한 번에 들여오려면 <b>⚙ 설정 › 🎵 음악 모으기</b>,<br>한 곡씩 넣으려면 아래 <b>＋</b> 단추를 쓰세요."}</div>`;
    _bindRows(box);
    setTimeout(_syncStickyTops, 0);   // rAF는 백그라운드 탭에서 멈추므로 사용하지 않는다
  }

  function _bindRows(box) {
    box.querySelectorAll("[data-open]").forEach(el => el.addEventListener("click", () => openDetail(el.dataset.open)));
    box.querySelectorAll("[data-plan]").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      openPlanSheet(b.dataset.plan);
    }));
    // ▶ 지금 보이는 목록 전체가 재생목록이 되어 그 곡부터 이어서 흐른다 / 같은 곡 재탭 = 일시정지
    box.querySelectorAll("[data-play]").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = b.dataset.play;
      if (playlist[playIdx] === id) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); return; }
      const ids = [...box.querySelectorAll("[data-play]")].map(x => x.dataset.play);
      playList(ids, id);
    }));
    box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      openDelSheet(b.dataset.del);
    }));
  }

  // ── 🗑 삭제 방식 선택: 곡 전체 / 음원만(정보 유지) ──────────────────
  let _delTarget = null;
  function openDelSheet(id) {
    const it = _byId(id); if (!it) return;
    _delTarget = id;
    $("#del-title").textContent = `「${it.title}」 삭제`;
    $("#del-list").style.display = it.hasAudio ? "" : "none";   // 음원 없는 곡은 완전 삭제만
    showSheet("del-overlay");
  }
  // 목록만 삭제 — 앱에 담긴 음원은 남긴다
  async function delListOnly() {
    if (playlist[playIdx] === _delTarget) closePlayer();
    await PraiseStore.remove(_delTarget, true);
    $("#del-overlay").classList.remove("show");
    render(); toast("목록에서 지웠습니다 (음원은 남아 있음)");
  }
  // 음원도 삭제 — 항목과 앱에 담긴 음원을 모두 지운다
  async function delAll() {
    if (playlist[playIdx] === _delTarget) closePlayer();
    await PraiseStore.remove(_delTarget);
    $("#del-overlay").classList.remove("show");
    render(); toast("곡과 음원을 모두 삭제했습니다");
  }

  // ── 🌙 예약 날짜 선택 시트 ────────────────────────────────────────────
  let _planTarget = null;
  const _dstr = (d) => { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };   // 로컬 기준 (UTC 금지)
  function _nextSaturday() {
    const d = new Date();
    d.setDate(d.getDate() + (((6 - d.getDay()) + 7) % 7 || 7));
    return _dstr(d);
  }
  function renderPlanChannels() {
    const it = _byId(_planTarget); if (!it) return;
    $("#plan-channels").innerHTML = PraiseStore.CHANNELS.map(ch =>
      `<button data-chtoggle="${ch.key}" class="${PraiseStore.inChannel(it, ch.key) ? "on" : ""}">${ch.name}</button>`).join("");
    $("#plan-channels").querySelectorAll("[data-chtoggle]").forEach(b => b.addEventListener("click", () => {
      const on = PraiseStore.toggleChannel(_planTarget, b.dataset.chtoggle);
      toast(on ? `${b.textContent} 채널에 넣었습니다` : `${b.textContent} 채널에서 뺐습니다`);
      renderPlanChannels(); render(); renderChannelList();
    }));
  }
  function openPlanSheet(id) {
    const it = _byId(id); if (!it) return;
    _planTarget = id;
    $("#plan-song").innerHTML = `<span style="flex:1">「${esc(it.title)}」</span>` +
      (it.hasAudio ? `<button class="ch-play" id="plan-play" title="들어 보기">${(!audio.paused && playlist[playIdx] === id) ? "⏸" : "▶"}</button>` : "");
    $("#plan-song").style.display = "flex";
    $("#plan-song").style.alignItems = "center";
    $("#plan-song").style.gap = "8px";
    { const pp = $("#plan-play");
      if (pp) pp.addEventListener("click", () => {
        if (playlist[playIdx] === id) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
        else playList([id], id);
      }); }
    const _pc = PraiseStore.catsOf(it);
    $("#plan-cat").innerHTML = PraiseStore.CATEGORIES
      .map(c => `<option value="${esc(c)}"${c === _pc[0] ? " selected" : ""}>${_pc.includes(c) && c !== _pc[0] ? "✓ " : ""}${esc(c)}</option>`).join("")
      + `<option value="__new__">➕ 새 분류 만들기…</option>`;
    $("#plan-tags").value = BibleTags.toInput((it.tags || []).filter(t => !PraiseStore.CHANNELS.some(c => t.includes(c.key))));
    renderPlanChannels();
    const tom = new Date(Date.now() + 86400000);
    $("#plan-date").value = _dstr(tom);
    $("#plan-date").min = _dstr(new Date());
    renderPlanList();
    showSheet("plan-overlay");
  }
  function renderPlanList() {
    const plan = PraiseStore.plan();
    const dates = Object.keys(plan).filter(d => plan[d].includes(_planTarget)).sort();
    $("#plan-list").innerHTML = dates.length
      ? `<div class="f-label" style="margin-top:0">예약된 날</div>` + dates.map(d =>
          `<div class="plan-row"><span>🌙 ${d.replace(/-/g, ".")}</span><button class="mini-x" data-undo="${d}">빼기 ✕</button></div>`).join("")
      : "";
    $("#plan-list").querySelectorAll("[data-undo]").forEach(b => b.addEventListener("click", () => {
      PraiseStore.togglePlan(b.dataset.undo, _planTarget);
      renderPlanList(); render(); syncAlarms();
    }));
  }
  function planAdd(dateStr) {
    if (!dateStr || dateStr < _dstr(new Date())) { toast("지난 날짜에는 담을 수 없습니다"); return; }
    const on = PraiseStore.togglePlan(dateStr, _planTarget);
    toast(on ? `${dateStr.replace(/-/g, ".")} 새벽에 담았습니다 🌙` : "그 날짜에서 뺐습니다");
    renderPlanList(); render(); syncAlarms();
  }

  // ── ⚙ 분류·채널 관리 (직접 만든 것만 삭제 가능) ──────────────────────
  function openManageSheet() { renderManage(); showSheet("manage-overlay"); }
  let _bkMounted = false;
  function openSettings() {
    if (!_bkMounted && typeof BackupUI !== "undefined") {
      BackupUI.injectCSS();
      // 찬양은 mp3가 무거워, 담을지 여부를 사용자가 고를 수 있다(BackupUI가 옵션을 띄운다)
      BackupUI.mount($("#praise-backup-ui"), { scopes: ["praise"], title: "매일찬양" });
      _bkMounted = true;
    }
    showSheet("settings-overlay");
  }
  function renderManage() {
    const cus = PraiseStore.custom();
    $("#mng-cats").innerHTML = PraiseStore.CATEGORIES.map(c => {
      const mine = cus.cats.includes(c);
      const n = PraiseStore.items().filter(x => PraiseStore.inCat(x, c)).length;
      return `<div class="mng-row"><span class="mn">${esc(c)} <span class="base">${n}곡${mine ? "" : " · 기본"}</span></span>
        ${mine ? `<button class="mini-x" data-delcat="${esc(c)}">삭제</button>` : ""}</div>`;
    }).join("");
    $("#mng-chans").innerHTML = PraiseStore.CHANNELS.map(ch => {
      const mine = cus.chans.some(x => x.key === ch.key);
      const n = PraiseStore.channelSongs(ch.key).length;
      return `<div class="mng-row"><span class="mn">${ch.name} <span class="base">${n}곡${mine ? "" : " · 기본"}</span></span>
        ${mine ? `<button class="mini-x" data-delch="${esc(ch.key)}">삭제</button>` : ""}</div>`;
    }).join("");
    $("#mng-cats").querySelectorAll("[data-delcat]").forEach(b => b.addEventListener("click", () => {
      const c = b.dataset.delcat;
      const n = PraiseStore.items().filter(x => PraiseStore.inCat(x, c)).length;
      if (!confirm(`분류 "${c}"를 지울까요?${n ? `\n이 분류의 ${n}곡은 '기타'로 옮겨집니다.` : ""}`)) return;
      PraiseStore.removeCategory(c);
      renderManage(); render(); renderChannelList();
      if (_planTarget) openPlanSheet(_planTarget);
      toast("분류를 삭제했습니다");
    }));
    $("#mng-chans").querySelectorAll("[data-delch]").forEach(b => b.addEventListener("click", () => {
      const k = b.dataset.delch;
      if (!confirm(`채널 "${k}"를 지울까요?\n곡에 붙은 태그는 그대로 남습니다.`)) return;
      PraiseStore.removeChannel(k);
      renderManage(); renderPlanChannels(); render(); syncAlarms();
      toast("채널을 삭제했습니다");
    }));
  }

  // ── 🎧 채널·분류·태그 곡 목록 창 ──────────────────────────────────────
  let _chListKey = null;
  const _keyLabel = (key) => key.startsWith("ch:")
    ? (PraiseStore.CHANNELS.find(c => c.key === key.slice(3)) || {}).name || key.slice(3)
    : key.startsWith("tag:") ? "#" + key.slice(4) : key.slice(4);
  const _keyIds = (key) => key.startsWith("ch:") ? PraiseStore.channelSongs(key.slice(3)).map(x => x.id)
    : key.startsWith("tag:") ? PraiseStore.tagSongs(key.slice(4)).map(x => x.id)
    : PraiseStore.items().filter(x => PraiseStore.inCat(x, key.slice(4))).map(x => x.id);

  function openChannelList(key) {
    _chListKey = key;
    renderChannelList();
    showSheet("chlist-overlay");
  }
  function renderChannelList() {
    if (!_chListKey) return;
    const ids = _keyIds(_chListKey);
    const songs = ids.map(_byId).filter(Boolean);
    $("#chlist-title").textContent = `${_keyLabel(_chListKey)} · ${songs.length}곡`;
    const playable = songs.filter(x => x.hasAudio).length;
    $("#chlist-play").disabled = $("#chlist-shuf").disabled = !playable;
    const playing = !audio.paused ? playlist[playIdx] : null;
    $("#chlist-body").innerHTML = songs.length
      ? songs.map(it => `<div class="praise-row" data-song="${it.id}">
          <div class="pr-main">
            <div class="pr-title">${it.hasAudio ? "" : "🚫 "}${esc(it.title)}</div>
            <div class="pr-sub">${esc(PraiseStore.catsOf(it).join("·"))}${(it.tags || []).length ? " · " + (it.tags || []).map(t => "#" + esc(t)).join(" ") : ""}</div>
          </div>
          ${it.hasAudio ? `<button class="rowbtn play" data-play="${it.id}" title="여기서 바로 듣기">${playing === it.id ? "⏸" : "▶"}</button>` : ""}
          <button class="rowbtn" data-songedit="${it.id}" title="분류·채널·태그 고치기">⚙</button>
        </div>`).join("")
      : `<div class="empty-line">이 묶음에 곡이 없습니다</div>`;
    // 행을 누르면 곡 설정 / ▶는 그 자리에서 재생 (목록 전체가 재생목록이 된다)
    $("#chlist-body").querySelectorAll("[data-song]").forEach(el => el.addEventListener("click", () => openPlanSheet(el.dataset.song)));
    $("#chlist-body").querySelectorAll("[data-play]").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = b.dataset.play;
      if (playlist[playIdx] === id) { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); return; }
      playList(songs.filter(x => x.hasAudio).map(x => x.id), id);
    }));
  }

  // ── 상세 (가사 크게 · 재생 · 유튜브 · 공유) ──────────────────────────
  function openDetail(id) {
    const it = _byId(id); if (!it) return;
    $("#d-title").textContent = it.title;
    $("#d-meta").innerHTML =
      [...PraiseStore.catsOf(it).map(c => `<span class="tag">${esc(c)}</span>`), `<span class="tag">${esc(it.lang)}</span>`,
       it.composer && `<span class="tag">작곡 ${esc(it.composer)}</span>`,
       it.lyricist && `<span class="tag">작사 ${esc(it.lyricist)}</span>`,
       it.performer && `<span class="tag">연주 ${esc(it.performer)}</span>`,
       it.verseRef && `<span class="tag">📖 ${esc(it.verseRef)}</span>`].filter(Boolean).join("") +
      `<div class="item-tags">${(it.tags || []).map(t => `<span class="htag">#${esc(t)}</span>`).join("")}</div>`;

    // 유튜브: 앱 안 임베드 + 앱으로 열기 버튼 (둘 다)
    const ytId = PraiseStore.youtubeId(it.youtube);
    $("#d-media").innerHTML =
      (it.hasAudio ? `<div class="d-actions"><button class="btn-gold" id="d-play">▶ 재생</button>
        <button class="btn-ghost" id="d-repeat">${_mode().ico} ${_mode().label}</button></div>` : "") +
      (ytId ? `<div class="yt-box"><iframe src="https://www.youtube-nocookie.com/embed/${ytId}" title="YouTube"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe></div>
        <a class="yt-open" href="${esc(it.youtube)}" target="_blank" rel="noopener">▶ 유튜브 앱에서 열기</a>` : "");

    $("#d-lyrics").textContent = it.lyrics || "";
    $("#d-lyrics").style.display = it.lyrics ? "" : "none";
    $("#d-fav").textContent = it.favorite ? "♥ 즐겨찾기 해제" : "♡ 즐겨찾기";
    $("#d-memo").textContent = it.memorized ? "✅ 가사 외움 해제" : "☑ 가사 외웠어요";
    $("#detail-overlay").dataset.id = id;
    showSheet("detail-overlay");

    const dp = $("#d-play");
    if (dp) dp.addEventListener("click", () => { playList([id], id); });
    const dr = $("#d-repeat");
    if (dr) dr.addEventListener("click", () => { cycleMode(); dr.textContent = `${_mode().ico} ${_mode().label}`; });
    if (ytId) PraiseStore.logListen(id);   // 임베드를 연 것도 들은 기록으로
  }
  function closeDetail() { $("#detail-overlay").classList.remove("show"); $("#d-media").innerHTML = ""; }

  // 음원 파일을 캐시에 기록해 네이티브 공유시트(카톡 등)로 — APK 전용
  async function _shareAudioFile(it) {
    const Cap = window.Capacitor, FS = Cap && Cap.Plugins && Cap.Plugins.Filesystem, SH = Cap && Cap.Plugins && Cap.Plugins.Share;
    if (!FS || !SH) return false;
    const rec = await PraiseAudio.get(it.id);
    if (!rec || !rec.blob) return false;
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(",")[1]);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(rec.blob);
    });
    const ext = (rec.mime || "").includes("wav") ? "wav" : (rec.mime || "").includes("webm") ? "webm" : "mp3";
    const fileName = `${it.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "찬양"}.${ext}`;
    const w = await FS.writeFile({ path: fileName, data: b64, directory: "CACHE" });
    await SH.share({ title: it.title, files: [w.uri] });
    return true;
  }

  async function shareFromDetail() {
    const it = _byId($("#detail-overlay").dataset.id); if (!it) return;
    // ① mp3가 있으면 실제 음원 파일을 공유 (카톡에 파일로 전달)
    if (it.hasAudio) {
      try { if (await _shareAudioFile(it)) { toast("음원 파일을 공유했습니다 🎵"); return; } }
      catch (e) { if (String(e.message || "").includes("cancel")) return; }
    }
    // ② 파일 공유가 안 되는 환경(웹)·유튜브 곡: 링크·텍스트 공유
    const lines = [it.title, it.performer && `연주: ${it.performer}`, it.verseRef && `📖 ${it.verseRef}`, it.youtube].filter(Boolean);
    const payload = { title: it.title, text: lines.join("\n") };
    if (it.youtube) payload.url = it.youtube;
    try {
      if (navigator.share) await navigator.share(payload);
      else { await navigator.clipboard.writeText(lines.join("\n")); toast("복사되었습니다 — 붙여넣어 공유하세요"); }
    } catch (e) {}
  }

  // ── 추가/수정 폼 ─────────────────────────────────────────────────────
  // 분류는 여러 개 고를 수 있다(채널과 같은 방식). 처음 고른 것이 대표 분류가
  // 되어 서재 목록에서 그 아래 한 번만 묶인다 — 같은 곡이 여러 번 나오지 않게.
  let _formCats = ["찬미가"];
  function renderFormCats() {
    const box = $("#f-cats");
    box.innerHTML = PraiseStore.CATEGORIES.map(c => {
      const on = _formCats.includes(c);
      const head = _formCats[0] === c;
      return `<button type="button" data-cat="${esc(c)}" class="${on ? "on" : ""}">${head ? "★ " : on ? "✓ " : ""}${esc(c)}</button>`;
    }).join("");
    $("#f-cats-hint").textContent = _formCats.length > 1
      ? `대표 분류: ${_formCats[0]} — 서재에서는 여기에만 묶입니다`
      : "여러 곳에 속하면 눌러서 더 고르세요";
    box.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => {
      const c = b.dataset.cat;
      if (_formCats.includes(c)) {
        if (_formCats.length === 1) { toast("분류는 하나 이상 골라야 합니다"); return; }
        _formCats = _formCats.filter(x => x !== c);
      } else _formCats = _formCats.concat(c);
      renderFormCats();
    }));
  }
  function openForm(id) {
    editingId = id || null; _pendingAudio = null;
    $("#form-title").textContent = id ? "찬양 수정" : "찬양 추가";
    $("#f-lang").innerHTML = PraiseStore.LANGS.map(c => `<option>${c}</option>`).join("");
    const it = id ? _byId(id) : null;
    $("#f-title").value = it ? it.title : "";
    _formCats = it ? PraiseStore.catsOf(it).slice() : ["찬미가"];
    renderFormCats();
    $("#f-lang").value = it ? it.lang : "한글";
    $("#f-composer").value = it ? it.composer : "";
    $("#f-lyricist").value = it ? it.lyricist : "";
    $("#f-performer").value = it ? it.performer : "";
    $("#f-verse").value = it ? it.verseRef : "";
    $("#f-youtube").value = it ? it.youtube : "";
    $("#f-lyrics").value = it ? it.lyrics : "";
    $("#f-tags").value = BibleTags.toInput(it && it.tags || []);
    $("#f-audio-state").textContent = it && it.hasAudio ? "🎵 음원 저장됨 (새 파일·녹음을 담으면 교체)" : "";
    $("#f-audio").value = "";
    $("#f-rec-preview").style.display = "none"; $("#f-rec-time").textContent = "";
    showSheet("form-overlay");
    // 자동 포커스 없음 — 안드로이드 IME 안정성 (사용자 탭으로 포커스)
  }
  function closeForm() {
    if (_rec) _stopRec(true);
    $("#form-overlay").classList.remove("show"); editingId = null; _pendingAudio = null;
    $("#f-rec-preview").style.display = "none"; $("#f-rec-time").textContent = "";
  }

  async function saveForm() {
    const title = $("#f-title").value.trim();
    if (!title) { toast("제목을 입력해 주세요"); return; }
    const userTags = BibleTags.fromInput($("#f-tags").value);
    const data = {
      title, category: _formCats[0] || "기타", cats: _formCats.slice(), lang: $("#f-lang").value,
      composer: $("#f-composer").value.trim(), lyricist: $("#f-lyricist").value.trim(),
      performer: $("#f-performer").value.trim(), verseRef: $("#f-verse").value.trim(),
      youtube: $("#f-youtube").value.trim(), lyrics: $("#f-lyrics").value,
      // 태그를 비우면 제목·작곡자·연주자·주제성경절에서 자동 추출
      tags: userTags.length ? userTags : BibleTags.auto([title, $("#f-composer").value, $("#f-performer").value, $("#f-verse").value])
    };
    if (data.youtube && !PraiseStore.youtubeId(data.youtube)) { toast("유튜브 주소를 인식하지 못했습니다 — 다시 확인해 주세요"); return; }

    let item;
    if (editingId) item = PraiseStore.update(editingId, data);
    else item = PraiseStore.add(data);
    if (_pendingAudio) {
      await PraiseAudio.save(item.id, _pendingAudio);
      PraiseStore.update(item.id, { hasAudio: true });
    }
    closeForm(); render(); toast(editingId ? "수정되었습니다" : "찬양이 담겼습니다 🎵");
  }

  // ── 🎙 즉석 녹음 — 읽기앱과 동일 로직 (MediaRecorder, 같은 mime 후보, 터치음 방지 지연) ──
  let _rec = null;   // { mr, stream, chunks, timer, elapsed, cancelled }
  function _recMime() {
    const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (const m of cands) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
    return "";
  }
  const _fmtRec = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

  async function toggleRec() {
    if (_rec) { _stopRec(false); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { toast("이 브라우저는 녹음을 지원하지 않습니다"); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) {
      toast(e.name === "NotFoundError" ? "마이크를 찾을 수 없습니다 — 기기에 마이크가 있는지 확인해 주세요"
          : "마이크 권한이 필요합니다 — 브라우저 설정에서 허용해 주세요");
      return;
    }
    const mime = _recMime();
    let mr;
    try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch (e) { stream.getTracks().forEach(t => t.stop()); toast("녹음기를 시작할 수 없습니다"); return; }
    _rec = { mr, stream, chunks: [], timer: null, elapsed: 0, cancelled: false };
    mr.ondataavailable = (e) => { if (e.data && e.data.size && _rec) _rec.chunks.push(e.data); };
    mr.onstop = _onRecStop;
    $("#f-rec-btn").textContent = "⏹ 녹음 끝";
    $("#f-rec-btn").classList.add("recording");
    $("#f-rec-cancel").style.display = "";
    $("#f-rec-preview").style.display = "none";
    // 버튼 터치음이 녹음에 들어가지 않도록 잠시 후 시작 (읽기앱과 동일)
    $("#f-rec-time").textContent = "잠시 후…";
    await new Promise(r => setTimeout(r, 700));
    if (!_rec || _rec.cancelled) return;
    _rec.mr.start(250);
    _rec.timer = setInterval(() => {
      if (!_rec) return;
      _rec.elapsed++;
      $("#f-rec-time").textContent = "● " + _fmtRec(_rec.elapsed);
    }, 1000);
    $("#f-rec-time").textContent = "● 00:00";
  }

  function _stopRec(cancel) {
    if (!_rec) return;
    _rec.cancelled = !!cancel;
    clearInterval(_rec.timer);
    try { if (_rec.mr.state !== "inactive") _rec.mr.stop(); else _onRecStop(); }
    catch (e) { _onRecStop(); }
  }

  function _onRecStop() {
    if (!_rec) return;
    const r = _rec; _rec = null;
    r.stream.getTracks().forEach(t => t.stop());
    $("#f-rec-btn").textContent = "🎙 즉석 녹음";
    $("#f-rec-btn").classList.remove("recording");
    $("#f-rec-cancel").style.display = "none";
    if (r.cancelled || !r.chunks.length) { $("#f-rec-time").textContent = ""; return; }
    const blob = new Blob(r.chunks, { type: r.mr.mimeType || _recMime() || "audio/webm" });
    _pendingAudio = blob;                       // 파일 업로드와 같은 경로 — 저장 시 음원으로 담김
    $("#f-rec-time").textContent = _fmtRec(r.elapsed);
    const pv = $("#f-rec-preview");
    pv.src = URL.createObjectURL(blob);
    pv.style.display = "";
    $("#f-audio-state").textContent = `🎙 녹음 ${_fmtRec(r.elapsed)} (${(blob.size / 1048576).toFixed(1)}MB) — 저장 시 담깁니다`;
  }

  // ── 📁 폴더째 담기 — 하위폴더 이름으로 자동분류, ID3 태그로 정보 채움 ──
  const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i;
  function _categoryFromPath(relPath) {
    // "찬양/찬송가/내평생에.mp3" → 경로 조각에서 분류명이 들어간 폴더를 찾는다
    const parts = String(relPath || "").split("/").slice(0, -1);
    for (const p of parts.reverse()) {
      for (const cat of PraiseStore.CATEGORIES) {
        if (p.includes(cat)) return cat;
      }
      if (/자연/.test(p)) return "자연의소리";
      if (/연주|피아노|instrumental/i.test(p)) return "연주찬양";
      if (/묵상/.test(p)) return "묵상찬양";
    }
    return "기타";
  }

  // ── 🛠 깨진 한글 일괄 복구 ────────────────────────────────────────────
  //  라틴으로 잘못 해독된 EUC-KR: "¿À ½Å½Ç…" → 글자를 바이트로 되돌려 EUC-KR로 재해독.
  //  라틴 해독기(cp1252)가 0x80~0x9F를 특수문자로 바꿔 놓으므로 역표로 복원한다.
  const _CP1252_REV = { 8364:128, 8218:130, 402:131, 8222:132, 8230:133, 8224:134, 8225:135, 710:136,
    8240:137, 352:138, 8249:139, 338:140, 381:142, 8216:145, 8217:146, 8220:147, 8221:148, 8226:149,
    8211:150, 8212:151, 732:152, 8482:153, 353:154, 8250:155, 339:156, 382:158, 376:159 };
  function _mojibakeFix(str) {
    if (!str || !/[À-ÿ¿¡°±§µ¤]/.test(str)) return null;   // 깨짐 특유의 고위 라틴 문자가 없으면 통과
    const bytes = [];
    for (const ch of str) {
      const c = ch.codePointAt(0);
      if (c <= 0xFF) bytes.push(c);
      else if (_CP1252_REV[c] !== undefined) bytes.push(_CP1252_REV[c]);
      else return null;                                    // 진짜 한글이 섞여 있으면 건드리지 않는다
    }
    try {
      const t = new TextDecoder("euc-kr", { fatal: true }).decode(new Uint8Array(bytes)).trim();
      return /[가-힣]/.test(t) ? t : null;
    } catch (e) { return null; }
  }
  // 담거나 목록을 열 때 자동으로 적용 — 깨진 글자는 들어오는 순간 되돌린다
  const _fixText = (v) => _mojibakeFix(v) || v;

  // 담기 전에 폴더별로 분류·채널을 고르게 한다 (무조건 '기타'로 들어가지 않도록)
  let _impGroups = null;
  function openImportSheet(audio) {
    // 하위폴더별로 묶기 — 폴더가 없으면 한 묶음
    const groups = {};
    for (const f of audio) {
      const rel = f.webkitRelativePath || "";
      const folder = rel.split("/").slice(0, -1).join("/") || "(폴더 없음)";
      (groups[folder] = groups[folder] || []).push(f);
    }
    _impGroups = Object.entries(groups).map(([folder, list]) => ({
      folder, list,
      cat: _categoryFromPath(list[0].webkitRelativePath || ""),   // 폴더 이름에서 추정한 값을 기본 선택
      ch: (PraiseStore.CHANNELS.find(c => folder.includes(c.key)) || {}).key || ""
    }));
    $("#imp-summary").innerHTML = `${audio.length}곡 · ${_impGroups.length}개 폴더 —
      폴더마다 <b>분류·채널</b>을 확인하고, 필요하면 <b>태그</b>를 더하세요.
      <br>폴더 이름은 자동으로 태그가 됩니다.`;
    $("#imp-groups").innerHTML = _impGroups.map((g, i) => `
      <div class="imp-group">
        <div class="imp-folder">📁 ${esc(g.folder)} <span>${g.list.length}곡</span></div>
        <div class="imp-selects">
          <select data-impcat="${i}">${PraiseStore.CATEGORIES.map(c => `<option${c === g.cat ? " selected" : ""}>${c}</option>`).join("")}</select>
          <select data-impch="${i}"><option value="">채널 없음</option>${PraiseStore.CHANNELS.map(c => `<option value="${c.key}"${c.key === g.ch ? " selected" : ""}>${c.name}</option>`).join("")}</select>
        </div>
        <input class="imp-tags" data-imptag="${i}" placeholder="🏷 태그 (쉼표로 나눠 적기 · 비워도 됩니다)">
      </div>`).join("");
    $("#imp-groups").querySelectorAll("[data-imptag]").forEach(el =>
      el.addEventListener("input", () => {
        _impGroups[+el.dataset.imptag].tags =
          el.value.split(/[,·]/).map(t => t.replace(/^#/, "").trim()).filter(Boolean);
      }));
    $("#imp-groups").querySelectorAll("[data-impcat]").forEach(el =>
      el.addEventListener("change", () => { _impGroups[+el.dataset.impcat].cat = el.value; }));
    $("#imp-groups").querySelectorAll("[data-impch]").forEach(el =>
      el.addEventListener("change", () => { _impGroups[+el.dataset.impch].ch = el.value; }));
    showSheet("imp-overlay");
  }

  async function importFiles(files) {
    const audio = files.filter(f => (f.type || "").startsWith("audio/") || AUDIO_EXT.test(f.name));
    if (!audio.length) { toast("담을 음원 파일이 없습니다"); return; }
    openImportSheet(audio);
  }

  // 시트에서 [담기]를 누르면 실제로 저장
  async function runImport() {
    if (!_impGroups) return;
    $("#imp-overlay").classList.remove("show");
    const total = _impGroups.reduce((a, g) => a + g.list.length, 0);
    toast(`가져오는 중… (${total}곡)`);
    const byCat = {};
    let done = 0;
    for (const g of _impGroups) for (const f of g.list) {
      const tag = (await ID3.read(f)) || {};
      const rel = f.webkitRelativePath || "";
      const cat = g.cat;                                   // 사용자가 고른 분류
      const title = _fixText(tag.title) || f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
      // 폴더 이름도 태그로 남긴다 (🏷 태그로 듣기에 그대로 묶임)
      const folderTags = rel.split("/").slice(0, -1)
        .map(seg => BibleTags.normalize(seg.replace(/찬양$/, "")))
        .filter(t => t && t.length >= 2 && !PraiseStore.CATEGORIES.includes(t + "찬양"));
      const item = PraiseStore.add({
        title, category: cat, lang: "한글",
        composer: _fixText(tag.composer) || "", lyricist: _fixText(tag.lyricist) || "",
        performer: _fixText(tag.performer) || "", lyrics: _fixText(tag.lyrics) || "",
        tags: Array.from(new Set([...(g.ch ? [g.ch] : []), ...(g.tags || []), ...folderTags,
          ...BibleTags.auto([title, tag.performer || "", tag.composer || ""])]))
      });
      await PraiseAudio.save(item.id, f);
      PraiseStore.update(item.id, { hasAudio: true });
      byCat[cat] = (byCat[cat] || 0) + 1;
      done++;
      if (done % 5 === 0) toast(`가져오는 중… ${done}/${total}`);
    }
    _impGroups = null;
    render();
    await syncAlarms();
    const summary = Object.entries(byCat).map(([c, n]) => `${c} ${n}`).join(" · ");
    toast(`✓ ${done}곡 담김 — ${summary}`);
  }

  // ── 💾 목록 저장 (음원 제외한 곡 정보만 — 파일이 작아 카톡으로도 전달 가능) ──
  async function saveList() {
    const items = PraiseStore.items();
    if (!items.length) { toast("저장할 곡이 없습니다"); return; }
    const payload = {
      app: "jesus-praise-list", v: 1, savedAt: Date.now(),
      items: items.map(x => ({ title: x.title, category: x.category, cats: PraiseStore.catsOf(x), lang: x.lang, tags: x.tags || [],
        composer: x.composer, lyricist: x.lyricist, performer: x.performer,
        verseRef: x.verseRef, youtube: x.youtube, lyrics: x.lyrics,
        memorized: !!x.memorized, favorite: !!x.favorite }))
    };
    const json = JSON.stringify(payload);
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    const name = `찬양목록_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
    try {
      const how = await CardExchange.shareFile(name, json, "찬양 목록");
      toast(how === "shared" ? `목록 ${items.length}곡을 보냈습니다 💾` : `목록 ${items.length}곡을 내려받았습니다 💾`);
    } catch (e) { toast("저장 실패: " + e.message); }
  }

  // 제목 매칭 키 — 공백·기호·번호 접두를 지워 기기가 달라도 같은 곡을 찾아낸다
  const _matchKey = (t) => String(t || "").toLowerCase()
    .replace(/^\d{1,3}[\s._-]*/, "").replace(/[\s._\-()[\]{}'"·,]/g, "");

  let _openData = null;
  async function openListFile(file) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { obj = null; }
    if (!obj || obj.app !== "jesus-praise-list" || !Array.isArray(obj.items)) { toast("찬양 목록 파일이 아닙니다"); return; }
    _openData = obj.items.map(x => Object.assign({}, x, {
      title: _fixText(x.title), performer: _fixText(x.performer),
      composer: _fixText(x.composer), lyricist: _fixText(x.lyricist)
    }));
    const mine = PraiseStore.items();
    const keys = new Set(mine.map(x => _matchKey(x.title)));
    const matched = _openData.filter(x => keys.has(_matchKey(x.title))).length;
    $("#open-summary").innerHTML =
      `파일 <b>${_openData.length}곡</b> · 이 기기 <b>${mine.length}곡</b> · 제목이 같은 곡 <b>${matched}곡</b>`;
    showSheet("open-overlay");
  }

  async function applyList(mode) {
    if (!_openData) return;
    $("#open-overlay").classList.remove("show");
    const incoming = _openData; _openData = null;

    if (mode === "replace") {
      if (!confirm(`이 기기의 곡 ${PraiseStore.items().length}개를 지우고 파일의 ${incoming.length}곡으로 교체할까요?\n(담아 둔 음원도 함께 지워집니다)`)) return;
      for (const it of PraiseStore.items()) await PraiseStore.remove(it.id);
      for (const x of incoming) PraiseStore.add(x);
      render(); await syncAlarms();
      toast(`목록을 교체했습니다 — ${incoming.length}곡`);
      return;
    }

    const arr = PraiseStore.items();
    if (mode === "cats") {
      // 분류·태그만 적용 — 음원·곡 수는 그대로, 다른 기기에서 정리한 분류를 옮길 때
      const byKey = {};
      incoming.forEach(x => { byKey[_matchKey(x.title)] = x; });
      let n = 0;
      for (let i = 0; i < arr.length; i++) {
        const src = byKey[_matchKey(arr[i].title)];
        if (!src) continue;
        const tags = Array.from(new Set([...(arr[i].tags || []), ...(src.tags || [])]));
        const cats = PraiseStore.normCats(
          Array.from(new Set([...(src.cats || (src.category ? [src.category] : [])), ...PraiseStore.catsOf(arr[i])])),
          src.category || PraiseStore.catsOf(arr[i])[0]);
        arr[i] = Object.assign({}, arr[i], { cats, category: cats[0], tags, updatedAt: Date.now() });
        n++;
      }
      PraiseStore.saveItems(arr);
      render(); await syncAlarms();
      toast(n ? `${n}곡의 분류·태그를 맞췄습니다 🏷` : "제목이 같은 곡을 찾지 못했습니다");
      return;
    }

    // merge — 이 기기에 없는 곡만 정보로 추가 (음원 없음)
    const keys = new Set(arr.map(x => _matchKey(x.title)));
    let added = 0;
    for (const x of incoming) {
      if (keys.has(_matchKey(x.title))) continue;
      PraiseStore.add(x); added++;
    }
    render(); await syncAlarms();
    toast(added ? `${added}곡을 목록에 추가했습니다 (음원은 없음)` : "추가할 새 곡이 없습니다");
  }

  // 🗑 목록 전체 삭제
  async function deleteAllSongs() {
    const items = PraiseStore.items();
    if (!items.length) { toast("삭제할 곡이 없습니다"); return; }
    if (!confirm(`찬양 ${items.length}곡을 목록에서 모두 지울까요?`)) return;
    const withAudio = items.filter(x => x.hasAudio).length;
    const alsoAudio = withAudio
      ? confirm(`담아 둔 음원 ${withAudio}개도 함께 지울까요?\n\n[확인] 음원도 삭제   [취소] 목록만 삭제(음원 보관)`)
      : true;
    closePlayer();
    for (const it of items) await PraiseStore.remove(it.id, !alsoAudio);
    render(); await syncAlarms();
    toast(alsoAudio ? "곡과 음원을 모두 삭제했습니다" : "목록만 지웠습니다 (음원은 보관)");
  }

  function editFromDetail() { const id = $("#detail-overlay").dataset.id; closeDetail(); openForm(id); }
  function deleteFromDetail() {
    const id = $("#detail-overlay").dataset.id;
    if (!confirm("이 찬양을 삭제할까요? (mp3 음원도 함께 지워집니다)")) return;
    PraiseStore.remove(id);
    closeDetail(); render(); toast("삭제되었습니다");
  }
  function toggleFav() {
    const id = $("#detail-overlay").dataset.id; const it = _byId(id);
    PraiseStore.update(id, { favorite: !it.favorite }); openDetail(id); render();
  }
  function toggleMemorized() {
    const id = $("#detail-overlay").dataset.id; const it = _byId(id);
    PraiseStore.update(id, { memorized: !it.memorized });
    if (!it.memorized) toast("가사를 외운 찬양이 하나 늘었습니다 ✅");
    openDetail(id); render();
  }

  // ── ③ 달력 ───────────────────────────────────────────────────────────
  function renderCal() {
    const y = calBase.getFullYear(), m = calBase.getMonth();
    $("#cal-title").textContent = `${y}년 ${m + 1}월`;
    const log = PraiseStore.log();
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    let html = ["일", "월", "화", "수", "목", "금", "토"].map(d => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < first; i++) html += `<div></div>`;
    const todayStr = PraiseStore.today();
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const n = (log[key] || []).length;
      html += `<div class="cal-cell${key === todayStr ? " today" : ""}${_calPicked === key ? " picked" : ""}" data-day="${key}">
        <span>${d}</span><div class="cds">${n ? `<i class="cd"></i>` : ""}</div></div>`;
    }
    $("#cal-grid").innerHTML = html;
    $("#cal-grid").querySelectorAll("[data-day]").forEach(c => c.addEventListener("click", () => {
      _calPicked = _calPicked === c.dataset.day ? null : c.dataset.day; renderCal();
    }));
    const monthDays = Object.keys(log).filter(k => k.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`)).length;
    $("#cal-sum").textContent = `이 달에 ${monthDays}일 찬양을 들었습니다`;
    const box = $("#cal-detail");
    if (!_calPicked) { box.innerHTML = ""; return; }
    const names = (log[_calPicked] || []).map(id => { const it = _byId(id); return it ? esc(it.title) : "(삭제된 찬양)"; });
    box.innerHTML = `<div class="cd-date">${_calPicked.replace(/-/g, ".")}</div>` +
      (names.length ? names.map(n => `<div class="cd-slot">🎵 ${n}</div>`).join("") : `<div class="cd-slot" style="color:var(--dim)">이날은 기록이 없습니다</div>`);
  }

  // ── ⏰ 새벽 알림 (APK 전용 — Capacitor LocalNotifications) ────────────
  const ALARM_KEY = "bible-praise-alarm";       // 날짜 예약 알림 { enabled, time }
  const CH_ALARM_KEY = "bible-praise-chalarm";  // 채널 알림 { 새벽: {on, time}, … } — 매일 반복
  const _LN = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.LocalNotifications) || null;
  function alarmCfg() { try { return JSON.parse(localStorage.getItem(ALARM_KEY) || "null") || { enabled: false, time: "05:30" }; } catch (e) { return { enabled: false, time: "05:30" }; } }
  const CH_DEFAULT_TIME = { "새벽": "05:00", "기도": "06:00", "밝은": "09:00", "맑은": "14:00", "저녁": "20:00", "천연계": "22:00" };
  function chAlarmCfg() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(CH_ALARM_KEY) || "{}") || {}; } catch (e) {}
    for (const ch of PraiseStore.CHANNELS) if (!c[ch.key]) c[ch.key] = { on: false, time: CH_DEFAULT_TIME[ch.key] || "06:00" };
    return c;
  }

  // 예약된 모든 미래 날짜에 알림을 다시 건다 (예약·설정이 바뀔 때마다)
  async function syncAlarms() {
    const LN = _LN(); if (!LN) return;
    const cfg = alarmCfg();
    try {
      // 내가 건 알림만 거둔다 — 매일기도 등 다른 앱이 건 알림까지 지우지 않도록.
      //  · 채널 알림 900000~900999  · 날짜 예약 알림 YYYYMMDD(1천만 이상)
      const isMine = (id) => (id >= 900000 && id <= 900999) || id >= 10000000;
      const pending = await LN.getPending();
      const mine = (pending.notifications || []).filter(x => isMine(x.id));
      if (mine.length) await LN.cancel({ notifications: mine.map(x => ({ id: x.id })) });
      const notis = [];
      // ① 채널 알림 — 매일 같은 시각 반복
      const cc = chAlarmCfg();
      PraiseStore.CHANNELS.forEach((ch, i) => {
        const c = cc[ch.key];
        if (!c || !c.on) return;
        const songs = PraiseStore.channelSongs(ch.key).filter(x => x.hasAudio);
        if (!songs.length) return;
        const [h2, m2] = (c.time || "06:00").split(":").map(Number);
        const at = new Date(); at.setHours(h2, m2, 0, 0);
        if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);   // 오늘 시각이 지났으면 내일부터
        notis.push({
          id: 900000 + i,
          title: `${ch.name} 시간입니다`,
          body: `${songs[0].title}${songs.length > 1 ? ` 외 ${songs.length - 1}곡` : ""}`,
          schedule: { at, repeats: true, every: "day" },
          extra: { channel: ch.key }
        });
      });
      // ② 날짜 예약 알림
      const cfg = alarmCfg();
      if (!cfg.enabled) { if (notis.length) await LN.schedule({ notifications: notis }); return; }
      const [hh, mm] = (cfg.time || "05:30").split(":").map(Number);
      const plan = PraiseStore.plan();
      const now = Date.now();
      for (const d of Object.keys(plan)) {
        if (!plan[d].length) continue;
        const at = new Date(`${d}T00:00:00`); at.setHours(hh, mm, 0, 0);
        if (at.getTime() <= now) continue;
        const first = _byId(plan[d][0]);
        notis.push({
          id: parseInt(d.replace(/-/g, ""), 10) % 2147483647,
          title: "🌅 새벽 찬양이 준비되어 있습니다",
          body: first ? `${first.title}${plan[d].length > 1 ? ` 외 ${plan[d].length - 1}곡` : ""}` : `${plan[d].length}곡`,
          schedule: { at },
          extra: { autoplay: d }
        });
      }
      if (notis.length) await LN.schedule({ notifications: notis });
    } catch (e) {}
  }

  function openAlarmSheet() {
    const cfg = alarmCfg();
    const cc = chAlarmCfg();
    $("#alarm-list").innerHTML = PraiseStore.CHANNELS.map(ch => {
      const n = PraiseStore.channelSongs(ch.key).filter(x => x.hasAudio).length;
      return `<div class="alarm-row">
        <input type="checkbox" data-chon="${ch.key}" ${cc[ch.key].on ? "checked" : ""}>
        <span class="an">${ch.name} <span style="font-weight:400;color:var(--dim);font-size:11px">${n}곡</span></span>
        <input type="time" data-chtime="${ch.key}" value="${cc[ch.key].time}">
      </div>`;
    }).join("");
    $("#alarm-on").checked = !!cfg.enabled;
    $("#alarm-time").value = cfg.time || "05:30";
    $("#alarm-status").textContent = _LN() ? "" : "⚠️ 지금은 웹 브라우저 — 알림은 앱(APK)에서 동작합니다";
    showSheet("alarm-overlay");
  }
  async function saveAlarm() {
    const cc = chAlarmCfg();
    $("#alarm-list").querySelectorAll("[data-chon]").forEach(el => { cc[el.dataset.chon].on = el.checked; });
    $("#alarm-list").querySelectorAll("[data-chtime]").forEach(el => { cc[el.dataset.chtime].time = el.value || "06:00"; });
    localStorage.setItem(CH_ALARM_KEY, JSON.stringify(cc));
    const anyCh = Object.values(cc).some(c => c.on);
    const cfg = { enabled: $("#alarm-on").checked, time: $("#alarm-time").value || "05:30" };
    localStorage.setItem(ALARM_KEY, JSON.stringify(cfg));
    const LN = _LN();
    if ((cfg.enabled || anyCh) && LN) {
      try { const p = await LN.requestPermissions(); if (p.display !== "granted") { toast("알림 권한이 거부되었습니다 — 설정에서 허용해 주세요"); } } catch (e) {}
    }
    await syncAlarms();
    $("#alarm-overlay").classList.remove("show");
    const onCh = PraiseStore.CHANNELS.filter(ch => cc[ch.key].on);
    toast(onCh.length ? `채널 알림 ${onCh.length}개 설정됨 ⏰ (매일 반복)`
        : cfg.enabled ? `예약일 ${cfg.time}에 알립니다 ⏰` : "알림이 꺼졌습니다");
  }

  // 알림을 눌러 들어오면 곧바로 연속재생
  function bindNotificationTap() {
    const LN = _LN(); if (!LN) return;
    try {
      LN.addListener("localNotificationActionPerformed", (ev) => {
        const ch = ev && ev.notification && ev.notification.extra && ev.notification.extra.channel;
        if (ch) _autoplayChannel(ch); else _autoplayToday();
      });
    } catch (e) {}
  }
  function _autoplayToday() {
    setTab("today");
    const ids = PraiseStore.planFor(PraiseStore.today());
    if (ids.length) playList(ids);
  }
  function _autoplayChannel(chKey) {
    setTab("today");
    const ids = PraiseStore.channelSongs(chKey).map(x => x.id);
    if (ids.length) playList(ids);
  }

  // ── 초기화 ───────────────────────────────────────────────────────────
  function init() {
    applyScheme();
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyScheme);
    document.querySelectorAll(".tabbar button[data-tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $("#add-btn").addEventListener("click", () => openForm(null));
    if (typeof Hymnal !== "undefined") Hymnal.init();
    BibleTags.attachAutoHash($("#f-tags"));
    BibleTags.hardenInputs();
    attachSheetCloseButtons();   // 모든 보조창 오른쪽 위에 ✕
    HelpTip.init();              // 긴 설명문은 [?] 뒤로 접어 둔다
    applySuiteDisplay();         // 허브 전체 설정의 글꼴·글자 크기 적용
    $("#form-save").addEventListener("click", saveForm);
    $("#form-cancel").addEventListener("click", closeForm);
    $("#f-rec-btn").addEventListener("click", toggleRec);
    $("#f-rec-cancel").addEventListener("click", () => _stopRec(true));
    $("#f-audio").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      _pendingAudio = f;
      $("#f-audio-state").textContent = `🎵 ${f.name} (${(f.size / 1048576).toFixed(1)}MB) — 저장 시 담깁니다`;
      // mp3 태그(ID3)로 빈 칸 자동 채움 — 사용자가 이미 쓴 값은 건드리지 않는다
      const tag = await ID3.read(f);
      if (tag) {
        const fill = (sel, v) => { const el = $(sel); if (v && !el.value.trim()) el.value = v; };
        fill("#f-title", tag.title);
        fill("#f-performer", tag.performer);
        fill("#f-composer", tag.composer);
        fill("#f-lyricist", tag.lyricist);
        fill("#f-lyrics", tag.lyrics);
        const got = ["title", "performer", "composer", "lyricist", "lyrics"].filter(k => tag[k]).length;
        if (got) toast(`파일 태그에서 ${got}개 항목을 채웠습니다 ✓`);
      } else if (!$("#f-title").value.trim()) {
        // 태그가 없으면 파일 이름을 제목 후보로
        $("#f-title").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
      }
    });
    $("#d-close").addEventListener("click", closeDetail);
    $("#d-share").addEventListener("click", shareFromDetail);
    $("#d-edit").addEventListener("click", editFromDetail);
    $("#d-del").addEventListener("click", deleteFromDetail);
    $("#d-fav").addEventListener("click", toggleFav);
    $("#d-memo").addEventListener("click", toggleMemorized);
    $("#lib-q").addEventListener("input", (e) => { libQuery = e.target.value.trim(); renderLib(); });
    // 🎵 음악 모으기 — 폴더를 통째로 고른다.
    // 안드로이드는 브라우저 폴더 창이 없어 SAF(찬미가 음원과 같은 장치)를 쓴다.
    // 그래야 500개 제한 없이, 하위 폴더 구조까지 그대로 읽어 분류를 추정할 수 있다.
    const saf = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.HymnTree) || null;

    async function collectFromTree() {
      const P = saf();
      const picked = await P.pick({ slot: "music" });        // 찬미가 폴더와 따로 기억한다
      if (!picked || !picked.ok) return;                     // 고르다 말았다
      if (picked.local === false &&
          !confirm("구글 드라이브 같은 구름 폴더입니다.\n\n목록을 다 못 읽을 수 있고 곡을 담는 데 오래 걸립니다.\n기기로 내려받은 폴더를 권합니다.\n\n그래도 하시겠습니까?")) return;

      toast("폴더를 읽는 중…");
      const res = await P.list({ slot: "music" });
      const paths = (res.files || []).slice().sort();
      if (!paths.length) { alert("이 폴더에서 음원을 찾지 못했습니다."); return; }
      if (res.cut) alert("폴더가 너무 커서 앞부분만 읽었습니다.");

      // 파일을 실제로 읽어 온다 — 담기는 앱 안에 넣는 일이라 내용이 필요하다
      toast(`${paths.length}곡을 여는 중…`);
      const files = [];
      for (const rel of paths) {
        try {
          const { uri } = await P.uri({ slot: "music", rel });
          const blob = await (await fetch(Capacitor.convertFileSrc(uri))).blob();
          const f = new File([blob], rel.split("/").pop(), { type: blob.type || "audio/mpeg" });
          // 폴더 구조를 그대로 넘겨야 분류·채널·태그 추정이 PC와 똑같이 된다
          Object.defineProperty(f, "webkitRelativePath", { value: rel });
          files.push(f);
        } catch (e) { /* 못 읽는 파일은 건너뛴다 */ }
      }
      if (!files.length) { alert("음원을 열지 못했습니다."); return; }
      importFiles(files);
    }

    $("#set-collect-btn").addEventListener("click", () => {
      if (saf()) return collectFromTree();                   // 안드로이드 앱
      const fi = $("#folder-input");
      if ("webkitdirectory" in fi) fi.click();               // PC 브라우저
      else { toast("여러 곡을 한 번에 선택해 주세요"); $("#files-input").click(); }
    });

    // 📁 찬미가 음원 폴더 — 곡을 열지 않고도 여기서 바로 잡는다
    const hymnAudioStat = () => {
      const el = $("#set-hymnaudio-stat"); if (!el || typeof HymnFolder === "undefined") return;
      // 폴더 읽기는 브라우저 기능(showDirectoryPicker)에 기대는데 사파리에는 그것이 없다.
      // 아이폰·아이패드는 크롬·엣지를 깔아도 속은 모두 사파리 엔진이라 마찬가지다.
      // 될 수 없는 단추를 눌러 보게 두면 영어 오류만 뜨므로, 단추를 감추고 까닭을 적는다.
      if (!HymnFolder.isSupported()) {
        const btn = $("#set-hymnaudio-btn"); if (btn) btn.style.display = "none";
        const dg = $("#set-hymnaudio-diag"); if (dg) dg.style.display = "none";
        el.innerHTML = "<b>이 기기에서는 폴더 읽기를 쓸 수 없습니다.</b><br>" +
          "아이폰·아이패드는 어느 브라우저를 쓰셔도 사파리와 같은 엔진으로 돌아가고, " +
          "사파리에는 폴더를 통째로 여는 기능이 없습니다 — 크롬이나 엣지로 바꾸셔도 같습니다.<br>" +
          "대신 <b>찬미가 › 곡 › 음원</b>에서 곡마다 파일을 넣어 두세요. " +
          "맥·윈도우의 크롬으로 같은 주소를 열면 폴더 읽기가 되고, 안드로이드는 앱(APK)에서 됩니다.";
        return;
      }
      el.innerHTML = HymnFolder.isLinked()
        ? `${esc(HymnFolder.treeName() || "폴더")} — 반주 <b>${HymnFolder.count("mr")}</b>곡 · 찬양 <b>${HymnFolder.count("song")}</b>곡`
        : "아직 폴더를 읽지 않았습니다. 반주·음정 조절을 쓰려면 한 번 읽어 주세요.";
    };
    if ($("#set-hymnaudio-btn")) {
      $("#set-hymnaudio-btn").addEventListener("click", async () => {
        if (typeof HymnFolder === "undefined") return;
        try {
          const got = await HymnFolder.link(true);
          if (!got) return;                       // 고르다 말았다
          toast(`${HymnFolder.treeName() || "폴더"} — 반주 ${HymnFolder.count("mr")}곡 · 찬양 ${HymnFolder.count("song")}곡`);
          if (HymnFolder.tooMany()) alert("폴더가 너무 커서 앞부분만 읽었습니다.\n\n음원만 담긴 폴더를 고르세요.");
          hymnAudioStat();
        } catch (e) {
          if (e && e.name !== "AbortError") alert("폴더를 읽지 못했습니다.\n\n" + (e.message || e));
        }
      });
    }
    // 🩺 음원 진단 — 목록이 아니라 **실제로 한 곡을 열어 보고** 어디서 막히는지 알린다
    if ($("#set-hymnaudio-diag")) {
      $("#set-hymnaudio-diag").addEventListener("click", async () => {
        if (typeof HymnFolder === "undefined" || !HymnFolder.diagnose) { alert("이 판에는 진단이 없습니다."); return; }
        const btn = $("#set-hymnaudio-diag"), was = btn.textContent;
        btn.textContent = "🩺 살펴보는 중…"; btn.disabled = true;
        try {
          const d = await HymnFolder.diagnose();
          const body = d.lines.map(([k, v]) => `${k} : ${v}`).join("\n");
          alert(`${d.ok ? "✅ 음원 진단 — 이상 없음" : "⚠️ 음원 진단 — 막힌 곳이 있습니다"}\n\n${body}\n\n${d.hint}`);
        } catch (e) {
          alert("진단하지 못했습니다.\n\n" + ((e && e.message) || e));
        } finally { btn.textContent = was; btn.disabled = false; }
      });
    }
    if ($("#settings-btn")) $("#settings-btn").addEventListener("click", hymnAudioStat);
    hymnAudioStat();
    $("#folder-input").addEventListener("change", (e) => { importFiles(Array.from(e.target.files || [])); e.target.value = ""; });
    $("#list-save-btn").addEventListener("click", saveList);
    $("#list-open-btn").addEventListener("click", () => $("#list-file").click());
    $("#list-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) openListFile(f);
      e.target.value = "";
    });
    $("#list-del-btn").addEventListener("click", deleteAllSongs);
    $("#open-cats").addEventListener("click", () => applyList("cats"));
    $("#open-merge").addEventListener("click", () => applyList("merge"));
    $("#open-replace").addEventListener("click", () => applyList("replace"));
    $("#open-cancel").addEventListener("click", () => { _openData = null; $("#open-overlay").classList.remove("show"); });
    $("#imp-go").addEventListener("click", runImport);
    $("#imp-cancel").addEventListener("click", () => { _impGroups = null; $("#imp-overlay").classList.remove("show"); });
    $("#files-input").addEventListener("change", (e) => { importFiles(Array.from(e.target.files || [])); e.target.value = ""; });
    $("#cal-prev").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() - 1, 1); renderCal(); });
    $("#cal-next").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 1); renderCal(); });
    $("#pl-toggle").addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
    $("#pl-next").addEventListener("click", () => _next(false));
    $("#pl-prev").addEventListener("click", _prev);
    $("#pl-mode").addEventListener("click", cycleMode);
    $("#pl-sleep").addEventListener("click", cycleSleep);
    $("#pl-close").addEventListener("click", closePlayer);
    $("#pl-back10").addEventListener("click", () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
    $("#pl-fwd10").addEventListener("click", () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });
    // 곡 이름을 누르면 그 곡의 상세 화면으로
    $("#pl-title").addEventListener("click", () => { const id = playlist[playIdx]; if (id) openDetail(id); });
    $("#pl-dur").addEventListener("click", toggleDurMode);
    // 진행 막대로 위치 옮기기 — 끄는 동안에는 시간 표시가 튀지 않게 잠근다
    const _sk = $("#pl-seek");
    const _seekStart = () => { _seeking = true; };
    const _seekEnd = () => {
      const d = audio.duration;
      if (isFinite(d) && d > 0) audio.currentTime = (_sk.value / 1000) * d;
      _seeking = false; _renderSeek();
    };
    ["mousedown", "touchstart"].forEach(ev => _sk.addEventListener(ev, _seekStart));
    ["mouseup", "touchend"].forEach(ev => _sk.addEventListener(ev, _seekEnd));
    _sk.addEventListener("change", _seekEnd);
    _sk.addEventListener("input", () => {
      const d = audio.duration;
      if (isFinite(d) && d > 0) $("#pl-cur").textContent = _mmss((_sk.value / 1000) * d);
    });
    ["detail-overlay", "form-overlay"].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener("click", (e) => { if (e.target === el) { el.classList.remove("show"); if (id === "detail-overlay") $("#d-media").innerHTML = ""; } });
    });
    $("#settings-btn").addEventListener("click", openSettings);
    $("#set-manage-btn").addEventListener("click", () => { $("#settings-overlay").classList.remove("show"); openManageSheet(); });
    $("#set-alarm-btn").addEventListener("click", () => { $("#settings-overlay").classList.remove("show"); openAlarmSheet(); });
    $("#settings-close").addEventListener("click", () => $("#settings-overlay").classList.remove("show"));
    $("#alarm-btn").addEventListener("click", openAlarmSheet);
    // 미니창의 설정 진입은 모두 전체 ⚙ 설정으로 모은다 — 설정 화면이 두 벌이 되지 않게
    $("#plan-alarm-link").addEventListener("click", () => { $("#plan-overlay").classList.remove("show"); openSettings(); });
    $("#alarm-close").addEventListener("click", () => $("#alarm-overlay").classList.remove("show"));
    $("#alarm-save").addEventListener("click", saveAlarm);
    $("#plan-close").addEventListener("click", () => $("#plan-overlay").classList.remove("show"));
    // 분류·태그는 고르는 즉시 반영 (따로 저장 버튼 없이)
    $("#plan-cat").addEventListener("change", (e) => {
      if (!_planTarget) return;
      if (e.target.value === "__new__") {
        const name = prompt("새 분류 이름을 입력해 주세요 (예: 어린이찬양)");
        const it = _byId(_planTarget);
        if (!name) { e.target.value = it ? PraiseStore.catsOf(it)[0] : "기타"; return; }
        const r = PraiseStore.addCategory(name);
        if (!r.ok) { toast(r.msg); e.target.value = it ? PraiseStore.catsOf(it)[0] : "기타"; return; }
        const nm = name.trim();
        PraiseStore.update(_planTarget, { cats: PraiseStore.normCats([nm].concat(PraiseStore.catsOf(it)), nm), category: nm });
        toast(`새 분류 "${name.trim()}"를 만들고 적용했습니다`);
        openPlanSheet(_planTarget); render(); renderChannelList();
        return;
      }
      const cur = _byId(_planTarget);
      const cats = PraiseStore.normCats(PraiseStore.catsOf(cur).concat(e.target.value), e.target.value);
      PraiseStore.update(_planTarget, { cats, category: cats[0] });
      toast(cats.length > 1 ? `대표 분류: ${cats[0]} (${cats.length}곳 소속)` : `분류: ${cats[0]}`);
      render(); renderChannelList();
    });
    $("#plan-add-ch").addEventListener("click", () => {
      const name = prompt("새 채널 이름 (예: 회복)");
      if (!name) return;
      const icon = prompt("채널 아이콘 이모지 하나 (비우면 🎵)", "🎵");
      const r = PraiseStore.addChannel(name, icon);
      if (!r.ok) { toast(r.msg); return; }
      if (_planTarget) PraiseStore.toggleChannel(_planTarget, name.trim());   // 만든 김에 이 곡을 넣어 준다
      toast(`"${name.trim()}" 채널을 만들었습니다`);
      renderPlanChannels(); render(); renderChannelList();
    });
    $("#plan-manage").addEventListener("click", () => { $("#plan-overlay").classList.remove("show"); openSettings(); });
    $("#mng-close").addEventListener("click", () => $("#manage-overlay").classList.remove("show"));
    $("#mng-cat-add").addEventListener("click", () => {
      const r = PraiseStore.addCategory($("#mng-cat-new").value);
      if (!r.ok) { toast(r.msg); return; }
      $("#mng-cat-new").value = ""; renderManage(); render();
      if (_planTarget) openPlanSheet(_planTarget);
      toast("분류를 추가했습니다");
    });
    $("#mng-ch-add").addEventListener("click", () => {
      const r = PraiseStore.addChannel($("#mng-ch-new").value, $("#mng-ch-icon").value);
      if (!r.ok) { toast(r.msg); return; }
      $("#mng-ch-new").value = ""; $("#mng-ch-icon").value = "";
      renderManage(); renderPlanChannels(); render();
      toast("채널을 추가했습니다");
    });
    $("#plan-tags").addEventListener("blur", () => {
      if (!_planTarget) return;
      const it = _byId(_planTarget); if (!it) return;
      const chTags = (it.tags || []).filter(t => PraiseStore.CHANNELS.some(c => t.includes(c.key)));
      const userT = BibleTags.fromInput($("#plan-tags").value);
      PraiseStore.update(_planTarget, { tags: Array.from(new Set([...chTags, ...userT])) });
      render(); renderChannelList();
    });
    BibleTags.attachAutoHash($("#plan-tags"));
    $("#chlist-close").addEventListener("click", () => { _chListKey = null; $("#chlist-overlay").classList.remove("show"); });
    $("#chlist-play").addEventListener("click", () => playList(_keyIds(_chListKey), null, false));
    $("#chlist-shuf").addEventListener("click", () => playList(_keyIds(_chListKey), null, true));
    $("#plan-save").addEventListener("click", () => planAdd($("#plan-date").value));
    document.querySelectorAll(".plan-quick button").forEach(b => b.addEventListener("click", () => {
      const q = b.dataset.quick;
      const d = q === "sat" ? _nextSaturday() : _dstr(new Date(Date.now() + (+q) * 86400000));
      $("#plan-date").value = d;
      planAdd(d);
    }));
    $("#del-list").addEventListener("click", delListOnly);
    $("#del-all").addEventListener("click", delAll);
    $("#del-cancel").addEventListener("click", () => $("#del-overlay").classList.remove("show"));
    ["plan-overlay", "alarm-overlay", "del-overlay", "imp-overlay", "open-overlay", "chlist-overlay", "manage-overlay"].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener("click", (e) => { if (e.target === el) el.classList.remove("show"); });
    });
    window.addEventListener("resize", _syncStickyTops);
    _syncStickyTops();
    bindNotificationTap();
    syncAlarms();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    // 성경읽기 하단 ♪ 는 praise.html#hymnal 로 건너온다 — 바로 찬미가를 편다
    setTab(location.hash === "#hymnal" ? "hymnal" : "today");
    // 알림 탭으로 열렸거나 ?autoplay=1 이면 곧바로 오늘 큐 재생
    { const ap = new URLSearchParams(location.search).get("autoplay");
      if (ap && ap.startsWith("ch:")) _autoplayChannel(ap.slice(3)); else if (ap) _autoplayToday();
      else _adoptRelay();   // 다른 화면에서 이어 듣던 음악을 넘겨받는다
    }
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
