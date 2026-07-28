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
  }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ── 플레이어 (mp3) ───────────────────────────────────────────────────
  const audio = new Audio();
  let playlist = [], playIdx = -1, repeatOne = false;

  async function playList(ids, start) {
    playlist = ids.filter(id => { const it = _byId(id); return it && it.hasAudio; });
    if (!playlist.length) { toast("재생할 mp3 음원이 없습니다 (유튜브 찬양은 목록에서 눌러 재생)"); return; }
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
    if (!it) { bar.classList.remove("show"); return; }
    bar.classList.add("show");
    $("#pl-title").textContent = it.title;
    $("#pl-toggle").textContent = audio.paused ? "▶" : "⏸";
    $("#pl-repeat").classList.toggle("on", repeatOne);
    $("#pl-pos").textContent = `${playIdx + 1}/${playlist.length}`;
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
    return `<div class="praise-row${listened && o.mark ? " done" : ""}" data-open="${it.id}">
      <div class="pr-main">
        <div class="pr-title">${it.memorized ? "✅ " : ""}${esc(it.title)} ${media}${yt}${it.favorite ? " ♥" : ""}</div>
        <div class="pr-sub">${esc(it.category)}${it.performer ? " · " + esc(it.performer) : ""}${it.verseRef ? " · 📖" + esc(it.verseRef) : ""}</div>
      </div>
      ${o.planBtn ? `<button class="moon${o.planned ? " on" : ""}" data-plan="${it.id}" title="내일 새벽에 담기">🌙</button>` : ""}
    </div>`;
  }

  function renderToday() {
    const box = $("#today-body");
    const todayIds = PraiseStore.planFor(PraiseStore.today());
    const tomIds = PraiseStore.planFor(PraiseStore.tomorrow());
    const todayItems = todayIds.map(_byId).filter(Boolean);
    const tomItems = tomIds.map(_byId).filter(Boolean);
    let html = `<div class="slot-head">🌅 오늘 새벽 찬양 <span class="slot-cnt">${todayItems.length}</span>
      ${todayItems.some(x => x.hasAudio) ? `<button class="play-all" id="play-today">▶ 연속재생</button>` : ""}</div>`;
    html += todayItems.map(it => _rowHtml(it, { mark: true })).join("") ||
      `<div class="empty-line">예약된 찬양이 없습니다 — 어젯밤에 담아 두면 여기 올라옵니다</div>`;
    html += `<div class="slot-head" style="margin-top:18px">🌙 내일 새벽 준비 <span class="slot-cnt">${tomItems.length}</span></div>`;
    html += tomItems.map(it => _rowHtml(it, { planBtn: true, planned: true })).join("") ||
      `<div class="empty-line">서재에서 🌙 를 눌러 내일 들을 찬양을 담아 두세요</div>`;
    box.innerHTML = html;
    const pa = $("#play-today");
    if (pa) pa.addEventListener("click", (e) => { e.stopPropagation(); playList(todayIds); });
    _bindRows(box);
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
  }

  function _bindRows(box) {
    box.querySelectorAll("[data-open]").forEach(el => el.addEventListener("click", () => openDetail(el.dataset.open)));
    box.querySelectorAll("[data-plan]").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = PraiseStore.togglePlan(PraiseStore.tomorrow(), b.dataset.plan);
      toast(on ? "내일 새벽 찬양에 담았습니다 🌙" : "내일 목록에서 뺐습니다");
      render();
    }));
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

  async function shareFromDetail() {
    const it = _byId($("#detail-overlay").dataset.id); if (!it) return;
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
    $("#f-title").focus();
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

  // ── 초기화 ───────────────────────────────────────────────────────────
  function init() {
    applyScheme();
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyScheme);
    document.querySelectorAll(".tabbar button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $("#add-btn").addEventListener("click", () => openForm(null));
    BibleTags.attachAutoHash($("#f-tags"));
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
    $("#cal-prev").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() - 1, 1); renderCal(); });
    $("#cal-next").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 1); renderCal(); });
    $("#pl-toggle").addEventListener("click", () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
    $("#pl-next").addEventListener("click", () => _next(false));
    $("#pl-prev").addEventListener("click", _prev);
    $("#pl-repeat").addEventListener("click", () => { repeatOne = !repeatOne; renderPlayer(); toast(repeatOne ? "한곡반복 켜짐 🔂" : "한곡반복 꺼짐"); });
    ["detail-overlay", "form-overlay"].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener("click", (e) => { if (e.target === el) { el.classList.remove("show"); if (id === "detail-overlay") $("#d-media").innerHTML = ""; } });
    });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    setTab("today");
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
