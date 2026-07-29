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
    try { s = localStorage.getItem("bible-color-scheme") || "system"; } catch (e) {}
    const eff = s === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : s;
    document.documentElement.dataset.theme = eff;
    syncStatusBar(eff);
  }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ── 플레이어 (mp3) ───────────────────────────────────────────────────
  const audio = new Audio();
  let playlist = [], playIdx = -1, repeatOne = false;

  async function playList(ids, start, shuffle) {
    let list = ids.filter(id => { const it = _byId(id); return it && it.hasAudio; });
    if (!list.length) { toast("재생할 음원이 없습니다 (유튜브 찬양은 상세에서 재생)"); return; }
    if (shuffle) {
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    }
    playlist = list;
    playIdx = Math.max(0, playlist.indexOf(start || playlist[0]));
    await _playCurrent();
  }

  async function _playCurrent() {
    const id = playlist[playIdx];
    const url = await PraiseAudio.getURL(id);
    if (!url) { _next(true); return; }
    if (audio.src && audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
    audio.src = url;
    audio.play().catch(() => {});
    PraiseStore.logListen(id);
    renderPlayer();
    if (tab === "today") renderToday();
  }

  function _next(auto) {
    if (repeatOne && auto) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    if (playIdx + 1 < playlist.length) { playIdx++; _playCurrent(); }
    else if (!auto) toast("마지막 곡입니다");
    else { audio.pause(); renderPlayer(); }
  }
  function _prev() { if (playIdx > 0) { playIdx--; _playCurrent(); } }
  audio.addEventListener("ended", () => _next(true));
  audio.addEventListener("play", renderPlayer);
  audio.addEventListener("pause", renderPlayer);

  function renderPlayer() {
    const bar = $("#player");
    const id = playlist[playIdx];
    const it = id && _byId(id);
    if (!it) { bar.classList.remove("show"); _syncRowPlayIcons(); return; }
    bar.classList.add("show");
    $("#pl-title").textContent = it.title;
    $("#pl-toggle").textContent = audio.paused ? "▶" : "⏸";
    $("#pl-repeat").classList.toggle("on", repeatOne);
    $("#pl-pos").textContent = `${playIdx + 1}/${playlist.length}`;
    _syncRowPlayIcons();
  }
  // 목록의 ▶/⏸ 아이콘을 현재 재생 상태에 맞춘다 (전체 재렌더 없이)
  function _syncRowPlayIcons() {
    const cur = !audio.paused ? playlist[playIdx] : null;
    document.querySelectorAll("[data-play]").forEach(b => { b.textContent = b.dataset.play === cur ? "⏸" : "▶"; });
  }
  function closePlayer() {
    audio.pause();
    if (audio.src && audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
    audio.removeAttribute("src");
    playlist = []; playIdx = -1;
    renderPlayer();
  }

  const _byId = (id) => PraiseStore.items().find(x => x.id === id);

  // ── 탭 ───────────────────────────────────────────────────────────────
  function setTab(t) {
    tab = t;
    document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("show", p.id === "page-" + t));
    render();
  }
  function render() {
    if (tab === "today") renderToday();
    else if (tab === "lib") renderLib();
    else if (tab === "cal") renderCal();
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
        <div class="pr-sub">${esc(it.category)}${it.performer ? " · " + esc(it.performer) : ""}${it.verseRef ? " · 📖" + esc(it.verseRef) : ""}</div>
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
    html += `<div class="slot-head" style="margin-top:18px">🎧 채널로 듣기 <span class="slot-cnt">곡의 🌙에서 채널을 고르세요</span></div>
      <div class="ch-grid">${chCards}</div>`;
    const catCards = PraiseStore.CATEGORIES.map(cat => {
      const ids = PraiseStore.items().filter(x => x.category === cat).map(x => x.id);
      return ids.length ? _channelCard(cat, ids, "cat:" + cat) : "";
    }).join("");
    if (catCards) html += `<div class="slot-head" style="margin-top:16px">📁 분류로 듣기</div><div class="ch-grid">${catCards}</div>`;
    const tagCards = PraiseStore.userTags().slice(0, 12)
      .map(t => _channelCard("#" + t.tag, PraiseStore.tagSongs(t.tag).map(x => x.id), "tag:" + t.tag)).join("");
    if (tagCards) html += `<div class="slot-head" style="margin-top:16px">🏷 태그로 듣기 <span class="slot-cnt">폴더 이름·직접 넣은 태그</span></div><div class="ch-grid">${tagCards}</div>`;

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
      : PraiseStore.items().filter(x => x.category === key.slice(4)).map(x => x.id);
    box.querySelectorAll("[data-chplay]").forEach(b => b.addEventListener("click", () => playList(chIds(b.dataset.chplay), null, false)));
    box.querySelectorAll("[data-chshuf]").forEach(b => b.addEventListener("click", () => playList(chIds(b.dataset.chshuf), null, true)));
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
    else if (libFilter) arr = arr.filter(x => x.category === libFilter);
    if (libQuery) {
      const q = libQuery.toLowerCase();
      arr = arr.filter(x => [x.title, x.composer, x.lyricist, x.performer, x.verseRef, (x.tags || []).join(" "), x.lyrics]
        .some(f => String(f || "").toLowerCase().includes(q)));
    }
    const tomIds = PraiseStore.planFor(PraiseStore.tomorrow());
    let html = "";
    for (const cat of PraiseStore.CATEGORIES) {
      const list = arr.filter(x => x.category === cat);
      if (!list.length) continue;
      html += `<div class="grp"><div class="grp-head">${cat} <span class="slot-cnt">${list.length}</span></div>`;
      html += list.map(it => _rowHtml(it, { planBtn: true, planned: tomIds.includes(it.id) })).join("");
      html += `</div>`;
    }
    box.innerHTML = html || `<div class="empty-line" style="margin-top:40px">${libQuery || libFilter ? "조건에 맞는 찬양이 없습니다" : "＋ 버튼으로 첫 찬양을 담아 보세요 (mp3 또는 유튜브 링크)"}</div>`;
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
    $("#del-overlay").classList.add("show");
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
      renderPlanChannels(); render();
    }));
  }
  function openPlanSheet(id) {
    const it = _byId(id); if (!it) return;
    _planTarget = id;
    $("#plan-song").textContent = `「${it.title}」`;
    renderPlanChannels();
    const tom = new Date(Date.now() + 86400000);
    $("#plan-date").value = _dstr(tom);
    $("#plan-date").min = _dstr(new Date());
    renderPlanList();
    $("#plan-overlay").classList.add("show");
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

  // ── 상세 (가사 크게 · 재생 · 유튜브 · 공유) ──────────────────────────
  function openDetail(id) {
    const it = _byId(id); if (!it) return;
    $("#d-title").textContent = it.title;
    $("#d-meta").innerHTML =
      [`<span class="tag">${esc(it.category)}</span>`, `<span class="tag">${esc(it.lang)}</span>`,
       it.composer && `<span class="tag">작곡 ${esc(it.composer)}</span>`,
       it.lyricist && `<span class="tag">작사 ${esc(it.lyricist)}</span>`,
       it.performer && `<span class="tag">연주 ${esc(it.performer)}</span>`,
       it.verseRef && `<span class="tag">📖 ${esc(it.verseRef)}</span>`].filter(Boolean).join("") +
      `<div class="item-tags">${(it.tags || []).map(t => `<span class="htag">#${esc(t)}</span>`).join("")}</div>`;

    // 유튜브: 앱 안 임베드 + 앱으로 열기 버튼 (둘 다)
    const ytId = PraiseStore.youtubeId(it.youtube);
    $("#d-media").innerHTML =
      (it.hasAudio ? `<div class="d-actions"><button class="btn-gold" id="d-play">▶ 재생</button>
        <button class="btn-ghost" id="d-repeat">${repeatOne ? "🔂 한곡반복 중" : "🔂 한곡반복"}</button></div>` : "") +
      (ytId ? `<div class="yt-box"><iframe src="https://www.youtube-nocookie.com/embed/${ytId}" title="YouTube"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe></div>
        <a class="yt-open" href="${esc(it.youtube)}" target="_blank" rel="noopener">▶ 유튜브 앱에서 열기</a>` : "");

    $("#d-lyrics").textContent = it.lyrics || "";
    $("#d-lyrics").style.display = it.lyrics ? "" : "none";
    $("#d-fav").textContent = it.favorite ? "♥ 즐겨찾기 해제" : "♡ 즐겨찾기";
    $("#d-memo").textContent = it.memorized ? "✅ 가사 외움 해제" : "☑ 가사 외웠어요";
    $("#detail-overlay").dataset.id = id;
    $("#detail-overlay").classList.add("show");

    const dp = $("#d-play");
    if (dp) dp.addEventListener("click", () => { playList([id], id); });
    const dr = $("#d-repeat");
    if (dr) dr.addEventListener("click", () => { repeatOne = !repeatOne; dr.textContent = repeatOne ? "🔂 한곡반복 중" : "🔂 한곡반복"; renderPlayer(); });
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
  function openForm(id) {
    editingId = id || null; _pendingAudio = null;
    $("#form-title").textContent = id ? "찬양 수정" : "찬양 추가";
    $("#f-category").innerHTML = PraiseStore.CATEGORIES.map(c => `<option>${c}</option>`).join("");
    $("#f-lang").innerHTML = PraiseStore.LANGS.map(c => `<option>${c}</option>`).join("");
    const it = id ? _byId(id) : null;
    $("#f-title").value = it ? it.title : "";
    $("#f-category").value = it ? it.category : "찬미가";
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
    $("#form-overlay").classList.add("show");
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
      title, category: $("#f-category").value, lang: $("#f-lang").value,
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
  function repairMojibake() {
    const arr = PraiseStore.items();
    let n = 0;
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i]; const patch = {};
      for (const f of ["title", "performer", "composer", "lyricist", "lyrics", "verseRef"]) {
        const fx = _mojibakeFix(it[f]);
        if (fx) patch[f] = fx;
      }
      if (Object.keys(patch).length) {
        patch.tags = BibleTags.auto([patch.title || it.title, patch.performer || it.performer, patch.composer || it.composer]);
        arr[i] = Object.assign({}, it, patch);
        n++;
      }
    }
    if (n) PraiseStore.saveItems(arr);
    render();
    toast(n ? `한글 복구 완료 — ${n}곡 수정 ✓` : "깨진 한글을 찾지 못했습니다");
  }

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
    $("#imp-summary").textContent = `${audio.length}곡 · ${_impGroups.length}개 폴더 — 폴더마다 분류와 채널을 확인해 주세요.`;
    $("#imp-groups").innerHTML = _impGroups.map((g, i) => `
      <div class="imp-group">
        <div class="imp-folder">📁 ${esc(g.folder)} <span>${g.list.length}곡</span></div>
        <div class="imp-selects">
          <select data-impcat="${i}">${PraiseStore.CATEGORIES.map(c => `<option${c === g.cat ? " selected" : ""}>${c}</option>`).join("")}</select>
          <select data-impch="${i}"><option value="">채널 없음</option>${PraiseStore.CHANNELS.map(c => `<option value="${c.key}"${c.key === g.ch ? " selected" : ""}>${c.name}</option>`).join("")}</select>
        </div>
      </div>`).join("");
    $("#imp-groups").querySelectorAll("[data-impcat]").forEach(el =>
      el.addEventListener("change", () => { _impGroups[+el.dataset.impcat].cat = el.value; }));
    $("#imp-groups").querySelectorAll("[data-impch]").forEach(el =>
      el.addEventListener("change", () => { _impGroups[+el.dataset.impch].ch = el.value; }));
    $("#imp-overlay").classList.add("show");
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
      const title = tag.title || f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
      // 폴더 이름도 태그로 남긴다 (🏷 태그로 듣기에 그대로 묶임)
      const folderTags = rel.split("/").slice(0, -1)
        .map(seg => BibleTags.normalize(seg.replace(/찬양$/, "")))
        .filter(t => t && t.length >= 2 && !PraiseStore.CATEGORIES.includes(t + "찬양"));
      const item = PraiseStore.add({
        title, category: cat, lang: "한글",
        composer: tag.composer || "", lyricist: tag.lyricist || "",
        performer: tag.performer || "", lyrics: tag.lyrics || "",
        tags: Array.from(new Set([...(g.ch ? [g.ch] : []), ...folderTags,
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
      const pending = await LN.getPending();
      if (pending.notifications && pending.notifications.length)
        await LN.cancel({ notifications: pending.notifications.map(x => ({ id: x.id })) });
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
    $("#alarm-overlay").classList.add("show");
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
    document.querySelectorAll(".tabbar button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $("#add-btn").addEventListener("click", () => openForm(null));
    BibleTags.attachAutoHash($("#f-tags"));
    BibleTags.hardenInputs();
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
    // 📁 폴더째 담기 — 폴더 선택을 지원하지 않는 기기(안드로이드 등)는 다중 파일 선택으로
    $("#folder-add-btn").addEventListener("click", () => {
      // 모바일(안드로이드·iOS)은 폴더 선택 창이 없어 다중 파일 선택으로 대신한다
      const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      const fi = $("#folder-input");
      if (!mobile && "webkitdirectory" in fi) fi.click();
      else { toast("여러 곡을 한 번에 선택해 주세요 (폴더 자동분류는 PC에서)"); $("#files-input").click(); }
    });
    $("#folder-input").addEventListener("change", (e) => { importFiles(Array.from(e.target.files || [])); e.target.value = ""; });
    $("#repair-btn").addEventListener("click", repairMojibake);
    $("#imp-go").addEventListener("click", runImport);
    $("#imp-cancel").addEventListener("click", () => { _impGroups = null; $("#imp-overlay").classList.remove("show"); });
    $("#files-input").addEventListener("change", (e) => { importFiles(Array.from(e.target.files || [])); e.target.value = ""; });
    $("#cal-prev").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() - 1, 1); renderCal(); });
    $("#cal-next").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 1); renderCal(); });
    $("#pl-toggle").addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
    $("#pl-next").addEventListener("click", () => _next(false));
    $("#pl-prev").addEventListener("click", _prev);
    $("#pl-repeat").addEventListener("click", () => { repeatOne = !repeatOne; renderPlayer(); toast(repeatOne ? "한곡반복 켜짐 🔂" : "한곡반복 꺼짐"); });
    $("#pl-close").addEventListener("click", closePlayer);
    ["detail-overlay", "form-overlay"].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener("click", (e) => { if (e.target === el) { el.classList.remove("show"); if (id === "detail-overlay") $("#d-media").innerHTML = ""; } });
    });
    $("#alarm-btn").addEventListener("click", openAlarmSheet);
    $("#plan-alarm-link").addEventListener("click", () => { $("#plan-overlay").classList.remove("show"); openAlarmSheet(); });
    $("#alarm-close").addEventListener("click", () => $("#alarm-overlay").classList.remove("show"));
    $("#alarm-save").addEventListener("click", saveAlarm);
    $("#plan-close").addEventListener("click", () => $("#plan-overlay").classList.remove("show"));
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
    ["plan-overlay", "alarm-overlay", "del-overlay", "imp-overlay"].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener("click", (e) => { if (e.target === el) el.classList.remove("show"); });
    });
    window.addEventListener("resize", _syncStickyTops);
    _syncStickyTops();
    bindNotificationTap();
    syncAlarms();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    setTab("today");
    // 알림 탭으로 열렸거나 ?autoplay=1 이면 곧바로 오늘 큐 재생
    { const ap = new URLSearchParams(location.search).get("autoplay");
      if (ap && ap.startsWith("ch:")) _autoplayChannel(ap.slice(3)); else if (ap) _autoplayToday(); }
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
