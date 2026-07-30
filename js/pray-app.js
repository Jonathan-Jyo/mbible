// ============================================================================
// pray-app — 매일기도 UI (pray.html 전용)
// 화면: 오늘의 기도 · 기도제목 · 감사노트 · 달력  +  🔒 비밀기도 잠금
// ============================================================================

(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const SLOT_ICON = { dawn: "🌅", noon: "☀️", eve: "🌙" };
  const STATUS_LABEL = Object.fromEntries(PrayStore.STATUS);
  let tab = "today";
  let calBase = new Date();          // 달력 표시 기준 월
  let editingId = null;              // 폼이 수정 모드일 때 대상 id
  let showAnsweredOnly = false;

  // ── 테마 (암송앱과 공유: bible-color-scheme = light | dark | system) ──
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

  // ── 비밀 항목 표시용: 잠금 상태별 제목 얻기 ──────────────────────────
  async function displayItem(item) {
    if (!item.secret) return item;
    const dec = await PrayCrypt.decryptItem(item);
    if (dec) return dec;
    // 잠긴 상태 — 이름은 평문이므로 "누구를 위한 기도인지"까지는 보여 준다
    return Object.assign({}, item, {
      title: item.person ? `🔒 ${item.person} 님을 위한 기도` : "🔒 은밀한 기도",
      content: "", _locked: true
    });
  }

  // ── 탭 전환 ──────────────────────────────────────────────────────────
  function setTab(t) {
    tab = t;
    document.querySelectorAll(".tabbar button[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("show", p.id === "page-" + t));
    render();
  }

  function render() {
    if (tab === "today") renderToday();
    else if (tab === "list") renderList();
    else if (tab === "thanks") renderThanks();
    else if (tab === "cal") renderCal();
  }

  // ── ① 오늘의 기도 ────────────────────────────────────────────────────
  async function renderToday() {
    const box = $("#today-body");
    const all = PrayStore.items().filter(x => x.status === "open" || x.status === "waiting");
    let html = "";
    // 시간대 안에서는 기도의 대상(세계선교→공동체→…→개인) 차례로 세운다.
    // 저장된 차례(기록순)대로 두면 볼 때마다 순서가 뒤죽박죽이었다.
    const targetRank = new Map(PrayStore.TARGETS.map((t, i) => [t, i]));
    const byTarget = (a, b) => {
      const d = (targetRank.has(a.target) ? targetRank.get(a.target) : 99)
              - (targetRank.has(b.target) ? targetRank.get(b.target) : 99);
      return d !== 0 ? d : (a.createdAt || 0) - (b.createdAt || 0);   // 같은 분류면 먼저 담은 것부터
    };
    for (const [slot, label] of PrayStore.SLOTS) {
      const list = all.filter(x => (x.slots || []).includes(slot)).sort(byTarget);
      const doneN = list.filter(x => PrayStore.loggedToday(slot, x.id)).length;
      const allDone = list.length > 0 && doneN === list.length;
      const folded = isFolded(slot, allDone);
      html += `<div class="slot-sec${folded ? " folded" : ""}" data-sec="${slot}">
        <div class="slot-head" data-fold="${slot}">
          ${SLOT_ICON[slot]} ${label}기도
          <span class="slot-cnt">${allDone ? "✓ 마침" : `${doneN}/${list.length}`}</span>
          <span class="fold-tri">▼</span>
        </div><div class="slot-items">`;
      if (!list.length) html += `<div class="empty-line">이 시간에 배정된 기도제목이 없습니다</div>`;
      for (const raw of list) {
        const it = await displayItem(raw);
        const done = PrayStore.loggedToday(slot, raw.id);
        html += `<div class="pray-row${done ? " done" : ""}" data-id="${raw.id}" data-slot="${slot}">
          <button class="chk" aria-label="기도 체크">${done ? "✓" : ""}</button>
          <div class="pray-main" data-open="${raw.id}">
            <div class="pray-title">${esc(it.title)}<span class="tag tag-${raw.target}">${raw.target}</span></div>
            ${it.promiseRef ? `<div class="pray-promise">📖 ${esc(it.promiseRef)}${it.promiseText ? ` — ${esc(it.promiseText.slice(0, 46))}${it.promiseText.length > 46 ? "…" : ""}` : ""}</div>` : ""}
          </div></div>`;
      }
      html += `</div></div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll(".chk").forEach(b => b.addEventListener("click", (e) => {
      const row = e.target.closest(".pray-row");
      const on = PrayStore.toggleLog(PrayStore.today(), row.dataset.slot, row.dataset.id);
      row.classList.toggle("done", on);
      e.target.textContent = on ? "✓" : "";
      renderToday();                       // 머릿줄의 진행 수(0/3 · ✓ 마침)를 바로 반영
    }));
    box.querySelectorAll("[data-fold]").forEach(h => h.addEventListener("click", (e) => {
      if (e.target.closest(".pray-row")) return;
      setFolded(h.dataset.fold, !h.closest(".slot-sec").classList.contains("folded"));
      h.closest(".slot-sec").classList.toggle("folded");
    }));
    box.querySelectorAll("[data-open]").forEach(el => el.addEventListener("click", () => openDetail(el.dataset.open)));
  }

  // 접기 상태 — 손으로 접은 것은 그대로 기억하고, 손대지 않은 시간대는
  // 그 시간의 기도를 다 마쳤을 때 저절로 접힌다(마친 것은 눈에서 비켜 주도록).
  const FOLD_KEY = "bible-pray-fold";
  function foldMap() { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function isFolded(slot, allDone) {
    const m = foldMap()[slot];
    if (!m || m.day !== PrayStore.today()) return allDone;   // 날이 바뀌면 손댄 기록은 무효
    return !!m.folded;
  }
  function setFolded(slot, folded) {
    const m = foldMap();
    m[slot] = { day: PrayStore.today(), folded: !!folded };
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(m)); } catch (e) {}
  }

  // ── ② 기도제목 목록 (대상별 그룹) ────────────────────────────────────
  async function renderList() {
    const box = $("#list-body");
    let arr = PrayStore.items();
    if (showAnsweredOnly) arr = arr.filter(x => x.status === "answered");
    $("#answered-filter").classList.toggle("on", showAnsweredOnly);
    let html = "";
    for (const target of PrayStore.TARGETS) {
      const list = arr.filter(x => x.target === target);
      if (!list.length) continue;
      html += `<div class="grp"><div class="grp-head">${esc(target)} <span class="slot-cnt">${list.length}</span></div>`;
      for (const raw of list) {
        const it = await displayItem(raw);
        html += `<div class="pray-row st-${raw.status}" data-open="${raw.id}">
          <div class="pray-main">
            <div class="pray-title">${esc(it.title)}
              <span class="tag">${esc(raw.type)}</span>
              <span class="tag st st-${raw.status}">${STATUS_LABEL[raw.status]}</span></div>
            <div class="pray-sub">${esc(raw.start)} 시작${raw.answeredAt ? ` · ${esc(raw.answeredAt)} 응답 ✓` : ""}</div>
          </div></div>`;
      }
      html += `</div>`;
    }
    box.innerHTML = html || `<div class="empty-line" style="margin-top:40px">${showAnsweredOnly ? "아직 응답으로 기록된 기도가 없습니다" : "＋ 버튼으로 첫 기도제목을 추가해 보세요"}</div>`;
    box.querySelectorAll("[data-open]").forEach(el => el.addEventListener("click", () => openDetail(el.dataset.open)));
  }

  // ── 상세 보기 ────────────────────────────────────────────────────────
  async function openDetail(id) {
    const raw = PrayStore.items().find(x => x.id === id);
    if (!raw) return;
    if (raw.secret && !PrayCrypt.isUnlocked()) { openPin(() => openDetail(id)); return; }
    const it = await displayItem(raw);
    $("#d-title").textContent = it.title;
    $("#d-meta").innerHTML = `<span class="tag">${esc(raw.target)}</span><span class="tag">${esc(raw.type)}</span>` +
      `<span class="tag st st-${raw.status}">${STATUS_LABEL[raw.status]}</span>` +
      (raw.slots || []).map(s => `<span class="tag">${SLOT_ICON[s]}</span>`).join("") +
      (raw.secret ? `<span class="tag">🔒</span>` : "");
    $("#d-content").textContent = it.content || "";
    $("#d-promise").innerHTML = it.promiseRef
      ? `<div class="promise-box">📖 <b>${esc(it.promiseRef)}</b>${it.promiseText ? `<div class="promise-text">${esc(it.promiseText)}</div>` : ""}</div>` : "";
    $("#d-dates").innerHTML = `<div class="item-tags">${(raw.tags || []).map(t => `<span class="htag">#${esc(t)}</span>`).join("")}</div>` +
      `${esc(raw.start)} 시작` + (raw.answeredAt ? ` · ${esc(raw.answeredAt)} 응답` : "");
    const atts = await AttachStore.list("pray:" + id);
    $("#d-content").insertAdjacentHTML("afterend", "");
    $("#d-attach").innerHTML = atts.map(a =>
      `<div class="attach-row"><span class="an" data-aopen="${a.id}">📎 ${esc(a.name)}</span><span class="as">${AttachStore.fmtSize(a.size)}</span>${a.drive ? "<span class='drive-ok'>☁️✓</span>" : ""}</div>`).join("");
    $("#d-attach").querySelectorAll("[data-aopen]").forEach(el => el.addEventListener("click", () => AttachStore.open(el.dataset.aopen)));
    $("#d-answer").innerHTML = raw.status === "answered" && it.answer
      ? `<div class="answer-box">🎉 ${esc(it.answer)}</div>` : "";
    $("#detail-overlay").dataset.id = id;
    $("#d-answer-btn").style.display = raw.status === "answered" ? "none" : "";
    $("#detail-overlay").classList.add("show");
  }
  function closeDetail() { $("#detail-overlay").classList.remove("show"); }

  async function answerFromDetail() {
    const id = $("#detail-overlay").dataset.id;
    const raw = PrayStore.items().find(x => x.id === id);
    if (!raw) return;
    const text = prompt("응답의 내용을 기록해 주세요 🎉", "");
    if (text === null) return;
    if (raw.secret) {
      // 비밀 항목: 응답도 암호문 안에 함께 저장
      const dec = await PrayCrypt.decryptItem(raw);
      if (!dec) { openPin(() => answerFromDetail()); return; }
      const enc = await PrayCrypt.encryptItem(Object.assign({}, dec, { answer: text }));
      PrayStore.update(id, { enc: enc.enc, status: "answered", answeredAt: PrayStore.today() });
    } else {
      PrayStore.markAnswered(id, text);
    }
    toast("응답으로 기록되었습니다 🙏");
    closeDetail(); render();
  }

  async function editFromDetail() {
    const id = $("#detail-overlay").dataset.id;
    closeDetail(); openForm(id);
  }

  function deleteFromDetail() {
    const id = $("#detail-overlay").dataset.id;
    if (!confirm("이 기도제목을 삭제할까요?\n달력에 남은 이 제목의 기도 기록도 함께 지워집니다.")) return;
    PrayStore.remove(id);
    AttachStore.removeByOwner("pray:" + id).catch(() => {});
    closeDetail(); render(); toast("삭제되었습니다");
  }

  // ── 추가/수정 폼 ─────────────────────────────────────────────────────
  async function openForm(id) {
    editingId = id || null;
    $("#form-title").textContent = id ? "기도제목 수정" : "기도제목 추가";
    $("#f-target").innerHTML = PrayStore.TARGETS.map(t => `<option>${t}</option>`).join("");
    $("#f-type").innerHTML = PrayStore.TYPES.map(t => `<option>${t}</option>`).join("");
    let it = { target: "개인", type: "간구", title: "", content: "", promiseRef: "", promiseText: "", slots: ["dawn"], secret: false };
    if (id) {
      const raw = PrayStore.items().find(x => x.id === id);
      if (raw) { const dec = await displayItem(raw); if (dec._locked) { openPin(() => openForm(id)); return; } it = dec; }
    }
    $("#f-target").value = it.target; $("#f-type").value = it.type;
    $("#f-title").value = it.title; $("#f-content").value = it.content;
    $("#f-pref").value = it.promiseRef; $("#f-ptext").value = it.promiseText;
    document.querySelectorAll("#f-slots button").forEach(b => b.classList.toggle("on", (it.slots || []).includes(b.dataset.slot)));
    $("#f-secret").checked = !!it.secret; syncSecretBtn();
    $("#f-tags").value = BibleTags.toInput(it.tags || []);
    _pendingFiles = [];
    await renderAttach(id);
    $("#form-overlay").classList.add("show");
    // 자동 포커스 없음 — 시트가 뜨는 중의 강제 포커스가 안드로이드 IME를 불안정하게 만든다
  }
  function closeForm() { $("#form-overlay").classList.remove("show"); editingId = null; _pendingFiles = []; }

  // ── 첨부파일 ─────────────────────────────────────────────────────────
  //  · 기존 항목: AttachStore에 바로 저장 / 새 항목: 저장 시점까지 _pendingFiles에 보관
  let _pendingFiles = [];
  async function renderAttach(itemId) {
    const box = $("#f-attach-list");
    const saved = itemId ? await AttachStore.list("pray:" + itemId) : [];
    box.innerHTML =
      saved.map(a => `<div class="attach-row" data-att="${a.id}">
        <span class="an">📎 ${a.name}</span><span class="as">${AttachStore.fmtSize(a.size)}</span>
        ${a.drive ? `<span class="drive-ok" title="드라이브에 복사됨">☁️✓</span>` : ""}
        <button class="mini-x" data-adel="${a.id}">✕</button></div>`).join("") +
      _pendingFiles.map((f, i) => `<div class="attach-row">
        <span class="an">📎 ${f.name}</span><span class="as">${AttachStore.fmtSize(f.size)} · 저장 시 첨부</span>
        <button class="mini-x" data-pdel="${i}">✕</button></div>`).join("");
    box.querySelectorAll("[data-att] .an").forEach(el => el.addEventListener("click", () => AttachStore.open(el.closest("[data-att]").dataset.att)));
    box.querySelectorAll("[data-adel]").forEach(b => b.addEventListener("click", async () => { await AttachStore.remove(b.dataset.adel); renderAttach(editingId); }));
    box.querySelectorAll("[data-pdel]").forEach(b => b.addEventListener("click", () => { _pendingFiles.splice(+b.dataset.pdel, 1); renderAttach(editingId); }));
  }

  async function saveForm() {
    const title = $("#f-title").value.trim();
    if (!title) { toast("제목을 입력해 주세요"); return; }
    const slots = Array.from(document.querySelectorAll("#f-slots button.on")).map(b => b.dataset.slot);
    const userTags = BibleTags.fromInput($("#f-tags").value);
    const data = {
      target: $("#f-target").value, type: $("#f-type").value,
      title, content: $("#f-content").value.trim(),
      promiseRef: $("#f-pref").value.trim(), promiseText: $("#f-ptext").value.trim(),
      // 태그를 비워 두면 제목·내용의 핵심 단어로 자동 채움 (사용자 입력이 있으면 그대로)
      tags: userTags.length ? userTags : BibleTags.auto([title, $("#f-content").value]),
      slots: slots.length ? slots : ["dawn"]
    };
    const wantSecret = $("#f-secret").checked;

    if (wantSecret && !PrayCrypt.isSetup()) {
      const pin = prompt("비밀기도용 PIN(4자리 이상)을 처음 설정합니다.\n⚠️ PIN을 잊으면 비밀 기도는 복구할 수 없습니다.");
      if (!pin || pin.length < 4) { toast("PIN 설정이 취소되었습니다 — 일반 기도로 저장하려면 🔒를 꺼 주세요"); return; }
      await PrayCrypt.setup(pin);
      toast("PIN이 설정되었습니다 🔒");
    }
    if (wantSecret && !PrayCrypt.isUnlocked()) { openPin(() => saveForm()); return; }

    let item;
    if (editingId) item = PrayStore.update(editingId, data);
    else item = PrayStore.add(data);

    for (const f of _pendingFiles) await AttachStore.add("pray:" + item.id, f);
    _pendingFiles = [];

    if (wantSecret) {
      const enc = await PrayCrypt.encryptItem(Object.assign({}, item, data));
      PrayStore.update(item.id, { secret: true, enc: enc.enc, title: "", content: "", answer: "" });
    } else if (item.secret) {
      PrayStore.update(item.id, { secret: false, enc: null, title: data.title, content: data.content });
    }
    closeForm(); render(); toast(editingId ? "수정되었습니다" : "기도제목이 추가되었습니다 🙏");
  }

  // ── ③ 감사노트 ───────────────────────────────────────────────────────
  function renderThanks() {
    const box = $("#thanks-list");
    const arr = PrayStore.thanks().slice().reverse();
    const byDate = {};
    arr.forEach(t => { (byDate[t.date] = byDate[t.date] || []).push(t); });
    box.innerHTML = Object.keys(byDate).map(d =>
      `<div class="grp"><div class="grp-head">${esc(d)}</div>` +
      byDate[d].map(t => `<div class="thanks-row"><span>🧡 ${esc(t.text)}</span><button class="mini-x" data-del="${t.id}">✕</button></div>`).join("") +
      `</div>`).join("") || `<div class="empty-line" style="margin-top:40px">오늘의 감사를 한 줄 남겨 보세요</div>`;
    box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
      PrayStore.removeThanks(b.dataset.del); renderThanks();
    }));
  }

  function submitThanks() {
    const v = $("#thanks-input").value.trim();
    if (!v) return;
    PrayStore.addThanks(v);
    $("#thanks-input").value = "";
    renderThanks(); toast("감사가 기록되었습니다 🧡");
  }

  // ── ④ 달력 ───────────────────────────────────────────────────────────
  let _calPicked = null;   // 선택한 날짜 (상세 표시)
  function renderCal() {
    const y = calBase.getFullYear(), m = calBase.getMonth();
    $("#cal-title").textContent = `${y}년 ${m + 1}월`;
    const log = PrayStore.log();
    const answered = {};
    PrayStore.items().forEach(x => { if (x.answeredAt) answered[x.answeredAt] = (answered[x.answeredAt] || 0) + 1; });
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    let html = ["일", "월", "화", "수", "목", "금", "토"].map(d => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < first; i++) html += `<div></div>`;
    const todayStr = PrayStore.today();
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const slots = Object.keys(log[key] || {});
      const dots = slots.map(() => `<i class="cd cd-pray"></i>`).join("") + (answered[key] ? `<i class="cd cd-ans"></i>` : "");
      html += `<div class="cal-cell${key === todayStr ? " today" : ""}${_calPicked === key ? " picked" : ""}" data-day="${key}"><span>${d}</span><div class="cds">${dots}</div></div>`;
    }
    $("#cal-grid").innerHTML = html;
    $("#cal-grid").querySelectorAll("[data-day]").forEach(c => c.addEventListener("click", () => {
      _calPicked = _calPicked === c.dataset.day ? null : c.dataset.day;
      renderCal();
    }));
    renderCalDetail();
    const monthPrayDays = Object.keys(log).filter(k => k.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`)).length;
    const monthAns = Object.keys(answered).filter(k => k.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`)).reduce((a, k) => a + answered[k], 0);
    $("#cal-sum").textContent = `이 달에 ${monthPrayDays}일 기도 · 응답 ${monthAns}건`;
  }

  // 선택한 날의 상세: 시간대별로 기도한 제목·응답·감사를 모두 보여준다 (이 앱의 몫)
  async function renderCalDetail() {
    const box = $("#cal-detail");
    if (!_calPicked) { box.innerHTML = ""; return; }
    const day = PrayStore.log()[_calPicked] || {};
    const items = PrayStore.items();
    const byId = Object.fromEntries(items.map(x => [x.id, x]));
    let html = `<div class="cd-date">${_calPicked.replace(/-/g, ".")}</div>`;
    let any = false;
    for (const [slot, label] of PrayStore.SLOTS) {
      const ids = day[slot] || [];
      if (!ids.length) continue;
      any = true;
      const names = [];
      for (const id of ids) {
        const raw = byId[id];
        if (!raw) { names.push("(삭제된 기도제목)"); continue; }
        const it = await displayItem(raw);
        names.push(esc(it.title));
      }
      html += `<div class="cd-slot"><b>${SLOT_ICON[slot]} ${label}</b> ${names.join(", ")}</div>`;
    }
    const answeredToday = items.filter(x => x.answeredAt === _calPicked);
    for (const raw of answeredToday) {
      any = true;
      const it = await displayItem(raw);
      html += `<div class="cd-slot cd-ans-line">🎉 <b>응답</b> ${esc(it.title)}</div>`;
    }
    const thanksToday = PrayStore.thanks().filter(t => t.date === _calPicked);
    for (const t of thanksToday) { any = true; html += `<div class="cd-slot">🧡 ${esc(t.text)}</div>`; }
    if (!any) html += `<div class="cd-slot" style="color:var(--dim)">이날은 기록이 없습니다</div>`;
    box.innerHTML = html;
  }

  // ── 🔒 PIN 잠금 ──────────────────────────────────────────────────────
  let _pinNext = null;
  function openPin(next) {
    _pinNext = next || null;
    $("#pin-msg").textContent = PrayCrypt.isSetup() ? "비밀기도 열람을 위해 PIN을 입력해 주세요" : "비밀기도용 PIN을 먼저 설정해 주세요 (기도제목에서 🔒를 켜면 설정됩니다)";
    $("#pin-input").value = "";
    $("#pin-overlay").classList.add("show");
  }
  function closePin() { $("#pin-overlay").classList.remove("show"); _pinNext = null; }
  async function submitPin() {
    try {
      await PrayCrypt.unlock($("#pin-input").value);
      $("#pin-overlay").classList.remove("show");
      toast("잠금이 해제되었습니다 🔓");
      const next = _pinNext; _pinNext = null;
      if (next) next(); else render();
    } catch (e) { toast(e.message); $("#pin-input").value = ""; $("#pin-input").focus(); }
  }

  // 앱을 벗어나면 자동 잠금 — "은밀한 기도"가 열린 채 방치되지 않도록
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && PrayCrypt.isUnlocked()) {
      PrayCrypt.lock(); render();
    }
  });

  // ── 💌 기도카드 전달·받기 (신뢰하는 분과) ───────────────────────────
  //  일반 카드: 비밀번호 없이 그대로 전달 (숨길 것이 없는데 번거롭게 하지 않는다)
  //  🔒 비밀 카드: 내 PIN 승인 → 전달용 비밀번호로 잠근 파일 → 공유시트
  //  받기: 잠긴 파일일 때만 비밀번호를 묻고, 비밀 카드면 "내" PIN으로 다시 잠가 저장
  async function shareCardFromDetail() {
    const id = $("#detail-overlay").dataset.id;
    const raw = PrayStore.items().find(x => x.id === id); if (!raw) return;
    let it = raw;
    let pass = "";                       // 일반 카드는 잠그지 않는다
    if (raw.secret) {
      if (!PrayCrypt.isUnlocked()) { openPin(() => shareCardFromDetail()); return; }   // 내 PIN 승인
      it = await PrayCrypt.decryptItem(raw);
      if (!it) { toast("복호화에 실패했습니다"); return; }
      pass = prompt("🔒 비밀 기도카드입니다.\n전달용 비밀번호를 정해 주세요 (4자리 이상).\n받는 분께는 파일과 다른 길(전화·말)로 알려 주세요.");
      if (pass === null) return;
      if (!pass || pass.length < 4) { toast("전달용 비밀번호는 4자리 이상이어야 합니다"); return; }
    }
    const payload = { target: it.target, type: it.type, title: it.title, content: it.content,
      promiseRef: it.promiseRef, promiseText: it.promiseText, tags: it.tags || [], slots: it.slots || ["dawn"], secret: !!raw.secret };
    try {
      const json = await CardExchange.pack("pray", payload, pass);
      const how = await CardExchange.shareFile(`기도카드_${CardExchange.safeName(it.title)}.json`, json, "기도카드");
      const lockNote = pass ? " (전달용 비밀번호를 따로 알려 주세요)" : "";
      toast(how === "shared" ? `기도카드를 전달했습니다 💌${lockNote}` : `기도카드 파일을 내려받았습니다 — 전달해 주세요${lockNote}`);
    } catch (e) { toast("전달 실패: " + e.message); }
  }

  let _pendingImport = null;
  async function importCardFile(file) {
    let parsed;
    try {
      const text = await file.text();
      let pass = "";
      if (CardExchange.isLocked(text)) {     // 잠긴 카드일 때만 비밀번호를 묻는다
        pass = prompt("🔒 잠긴 기도카드입니다.\n보낸 분께 들은 전달용 비밀번호를 입력해 주세요.");
        if (pass === null) return;
      }
      parsed = await CardExchange.unpack(text, pass);
    } catch (e) { toast(e.message); return; }
    if (parsed.kind !== "pray") { toast("이 파일은 VIP카드입니다 — 매일나눔의 [📥 카드 받기]에서 열어 주세요"); return; }
    const p = parsed.payload;
    if (!confirm(`「${p.title}」 기도카드를 내 기도제목에 추가할까요?${p.secret ? "\n(비밀 카드 — 내 PIN으로 잠가 저장됩니다)" : ""}`)) return;
    _pendingImport = p;
    finishImport();
  }
  async function finishImport() {
    const p = _pendingImport; if (!p) return;
    if (p.secret && !PrayCrypt.isSetup()) {
      const pin = prompt("비밀 카드를 잠글 내 PIN(4자리 이상)을 처음 설정합니다.\n⚠️ PIN을 잊으면 복구할 수 없습니다.");
      if (!pin || pin.length < 4) { toast("PIN 설정이 취소되어 카드를 저장하지 않았습니다"); _pendingImport = null; return; }
      await PrayCrypt.setup(pin);
    }
    if (p.secret && !PrayCrypt.isUnlocked()) { openPin(() => finishImport()); return; }
    const item = PrayStore.add({ target: p.target, type: p.type, title: p.title, content: p.content,
      promiseRef: p.promiseRef, promiseText: p.promiseText, tags: p.tags, slots: p.slots });
    if (p.secret) {
      const enc = await PrayCrypt.encryptItem(Object.assign({}, item, { title: p.title, content: p.content }));
      PrayStore.update(item.id, { secret: true, enc: enc.enc, title: "", content: "", answer: "" });
    }
    _pendingImport = null;
    render();
    toast(`기도카드가 추가되었습니다 🙏${p.secret ? " (내 PIN으로 잠금)" : ""}`);
  }

  // ── ⏰ 기도시간 알림 (APK 전용 — Capacitor LocalNotifications) ────────
  //  새벽·점심·저녁/밤 각각 시각을 정해 두면 매일 그 시각에 알려 준다.
  //  알림 id는 930000번대만 쓴다 — 매일찬양(900000번대·날짜번호)과 겹치지 않게.
  const PRAY_ALARM_KEY = "bible-pray-alarm";
  const PRAY_ALARM_BASE = 930000;
  const ALARM_DEFAULT_TIME = { dawn: "05:00", noon: "12:00", eve: "21:00" };
  const _LN = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.LocalNotifications) || null;
  function prayAlarmCfg() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(PRAY_ALARM_KEY) || "{}") || {}; } catch (e) {}
    for (const [slot] of PrayStore.SLOTS)
      if (!c[slot]) c[slot] = { on: false, time: ALARM_DEFAULT_TIME[slot] || "06:00" };
    return c;
  }
  async function syncPrayAlarms() {
    const LN = _LN(); if (!LN) return;
    try {
      const isMine = (id) => id >= PRAY_ALARM_BASE && id <= PRAY_ALARM_BASE + 999;
      const pending = await LN.getPending();
      const mine = (pending.notifications || []).filter(x => isMine(x.id));
      if (mine.length) await LN.cancel({ notifications: mine.map(x => ({ id: x.id })) });

      const cc = prayAlarmCfg();
      const open = PrayStore.items().filter(x => x.status === "open" || x.status === "waiting");
      const notis = [];
      PrayStore.SLOTS.forEach(([slot, label], i) => {
        const c = cc[slot];
        if (!c || !c.on) return;
        const n = open.filter(x => (x.slots || []).includes(slot)).length;
        const [hh, mm] = (c.time || "06:00").split(":").map(Number);
        const at = new Date(); at.setHours(hh, mm, 0, 0);
        if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);   // 오늘 시각이 지났으면 내일부터
        notis.push({
          id: PRAY_ALARM_BASE + i,
          title: `${SLOT_ICON[slot]} ${label}기도 시간입니다`,
          body: n ? `기도제목 ${n}개가 기다리고 있습니다` : "잠시 주님 앞에 나아가 보세요",
          schedule: { at, repeats: true, every: "day" },
          extra: { praySlot: slot }
        });
      });
      if (notis.length) await LN.schedule({ notifications: notis });
    } catch (e) {}
  }
  function openAlarmSheet() {
    const cc = prayAlarmCfg();
    const open = PrayStore.items().filter(x => x.status === "open" || x.status === "waiting");
    $("#alarm-list").innerHTML = PrayStore.SLOTS.map(([slot, label]) => {
      const n = open.filter(x => (x.slots || []).includes(slot)).length;
      return `<div class="alarm-row">
        <input type="checkbox" data-on="${slot}" ${cc[slot].on ? "checked" : ""}>
        <span class="an">${SLOT_ICON[slot]} ${label}기도 <span style="font-weight:400;color:var(--dim);font-size:11px">${n}개</span></span>
        <input type="time" data-time="${slot}" value="${cc[slot].time}">
      </div>`;
    }).join("");
    $("#alarm-status").textContent = _LN() ? "" : "⚠️ 지금은 웹 브라우저 — 알림은 앱(APK)에서 동작합니다";
    $("#alarm-overlay").classList.add("show");
  }
  async function savePrayAlarm() {
    const cc = prayAlarmCfg();
    $("#alarm-list").querySelectorAll("[data-on]").forEach(el => { cc[el.dataset.on].on = el.checked; });
    $("#alarm-list").querySelectorAll("[data-time]").forEach(el => { cc[el.dataset.time].time = el.value || "06:00"; });
    try { localStorage.setItem(PRAY_ALARM_KEY, JSON.stringify(cc)); } catch (e) {}
    const on = PrayStore.SLOTS.filter(([s]) => cc[s].on);
    const LN = _LN();
    if (on.length && LN) {
      try { const p = await LN.requestPermissions(); if (p.display !== "granted") toast("알림 권한이 거부되었습니다 — 설정에서 허용해 주세요"); } catch (e) {}
    }
    await syncPrayAlarms();
    $("#alarm-overlay").classList.remove("show");
    toast(on.length ? `기도시간 알림 ${on.length}개 설정됨 ⏰ (매일 반복)` : "기도시간 알림이 꺼졌습니다");
  }

  // ── 🎵 기도찬양: 기도 화면을 떠나지 않고 '기도' 채널을 이어 재생 ──────
  //  기도앱에 머무는 동안 끊기지 않게: 한 곡이 끝나면 다음 곡, 목록 끝나면 처음부터.
  //  화면 맨 아래 미니 플레이어로 곡 이름과 ⏮⏯⏭·닫기를 늘 조절할 수 있다.
  const _prayAudio = new Audio();
  _prayAudio.preload = "auto";
  let _pmList = [], _pmIdx = -1, _pmTitles = [];

  function _pmRenderBar() {
    const bar = $("#pm-bar"); if (!bar) return;
    const on = _pmList.length > 0;
    bar.classList.toggle("show", on);
    document.body.classList.toggle("pm-on", on);
    // 헤더 버튼은 플레이어를 껐을 때도 갱신해야 한다 —
    // 아래 early return 뒤에 두었더니 ✕로 끈 뒤에도 ⏸ 인 채로 굳어 있었다.
    const hb = $("#praymusic-btn");
    if (hb) hb.textContent = (on && !_prayAudio.paused) ? "⏸" : "▶";
    if (!on) return;
    $("#pm-title").textContent = _pmTitles[_pmIdx] || "기도찬양";
    $("#pm-sub").textContent = `기도찬양 ${_pmIdx + 1}/${_pmList.length}`;
    $("#pm-play").textContent = _prayAudio.paused ? "▶" : "⏸";
  }
  async function _pmPlayCurrent() {
    const id = _pmList[_pmIdx];
    const url = await PraiseAudio.getURL(id);
    if (!url) { _pmNext(); return; }
    if (_prayAudio.src && _prayAudio.src.startsWith("blob:")) URL.revokeObjectURL(_prayAudio.src);
    _prayAudio.src = url;
    _prayAudio.play().catch(() => toast("▶ 버튼을 한 번 더 눌러 주세요"));
    try { PraiseStore.logListen(id); } catch (e) {}
    _pmRenderBar();
  }
  function _pmStep(d) {
    if (!_pmList.length) return;
    _pmIdx = (_pmIdx + d + _pmList.length) % _pmList.length;   // 끝나면 처음부터 — 기도 내내 흐르게
    _pmPlayCurrent();
  }
  function _pmNext() { _pmStep(1); }
  _prayAudio.addEventListener("ended", _pmNext);
  _prayAudio.addEventListener("play", _pmRenderBar);
  _prayAudio.addEventListener("pause", _pmRenderBar);
  // 재생이 막히거나 파일이 깨져도 멈춰 서지 않고 다음 곡으로 넘어간다
  _prayAudio.addEventListener("error", () => { if (_pmList.length > 1) _pmNext(); });

  function _pmStop() {
    _prayAudio.pause();
    if (_prayAudio.src && _prayAudio.src.startsWith("blob:")) URL.revokeObjectURL(_prayAudio.src);
    _prayAudio.removeAttribute("src");
    _pmList = []; _pmTitles = []; _pmIdx = -1;
    _pmRenderBar();
    toast("기도찬양을 껐습니다");
  }
  async function togglePrayMusic() {
    if (_pmList.length) {                      // 이미 켜져 있으면 재생/일시정지만
      if (_prayAudio.paused) _prayAudio.play().catch(() => {}); else _prayAudio.pause();
      _pmRenderBar();
      return;
    }
    if (typeof PraiseStore === "undefined") { toast("찬양 모듈을 불러오지 못했습니다"); return; }
    const songs = PraiseStore.channelSongs("기도").filter(x => x.hasAudio);
    if (!songs.length) { toast("기도찬양이 없습니다 — 매일찬양에서 #기도 태그를 붙이거나 '기도찬양' 폴더로 담아 주세요"); return; }
    _pmList = songs.map(x => x.id);
    _pmTitles = songs.map(x => x.title || "기도찬양");
    _pmIdx = 0;
    toast(`기도찬양 ${_pmList.length}곡을 이어서 틀어 드립니다 🎵`);
    await _pmPlayCurrent();
  }

  // 기도제목마다 🔑(잠그지 않음) ↔ 🔒(비밀). 기본은 열린 🔑 — 대부분의 기도는
  // 숨길 것이 없고, 숨기고 싶을 때만 눌러서 잠근다.
  function syncSecretBtn() {
    const on = $("#f-secret").checked;
    const b = $("#f-secret-btn");
    b.textContent = on ? "🔒 비밀 기도" : "🔑 잠그지 않음";
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.nextElementSibling && (b.nextElementSibling.textContent =
      on ? "PIN으로만 열람됩니다 — 눌러서 🔑 로" : "눌러서 🔒 비밀 기도로 — PIN으로만 열람");
  }

  function openSettings() {
    const setup = PrayCrypt.isSetup(), open = PrayCrypt.isUnlocked();
    $("#set-lockrow").innerHTML = setup
      ? `<button class="btn-ghost w100" id="set-lock-toggle">${open ? "🔓 지금 열려 있음 — 눌러서 잠그기" : "🔒 잠겨 있음 — 눌러서 열기"}</button>`
      : `<div style="font-size:12.5px;color:var(--dim)">아직 PIN이 없습니다 — 기도제목을 🔒 로 저장할 때 정합니다</div>`;
    const t = $("#set-lock-toggle");
    if (t) t.addEventListener("click", () => {
      $("#settings-overlay").classList.remove("show");
      if (PrayCrypt.isUnlocked()) { PrayCrypt.lock(); render(); toast("잠금되었습니다 🔒"); }
      else openPin(null);
    });
    $("#settings-overlay").classList.add("show");
  }

  // ── 초기화 ───────────────────────────────────────────────────────────
  function init() {
    applyScheme();
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyScheme);
    document.querySelectorAll(".tabbar button[data-tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $("#add-btn").addEventListener("click", () => openForm(null));
    BibleTags.attachAutoHash($("#f-tags"));
    BibleTags.hardenInputs();
    attachSheetCloseButtons();   // 모든 보조창 오른쪽 위에 ✕
    $("#f-secret-btn").addEventListener("click", () => {
      const c = $("#f-secret"); c.checked = !c.checked; syncSecretBtn();
    });
    $("#form-save").addEventListener("click", saveForm);
    $("#form-cancel").addEventListener("click", closeForm);
    $("#d-close").addEventListener("click", closeDetail);
    $("#d-answer-btn").addEventListener("click", answerFromDetail);
    $("#d-edit-btn").addEventListener("click", editFromDetail);
    $("#d-del-btn").addEventListener("click", deleteFromDetail);
    $("#thanks-add").addEventListener("click", submitThanks);
    $("#thanks-input").addEventListener("keydown", (e) => { if (e.key === "Enter") submitThanks(); });
    $("#cal-prev").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() - 1, 1); renderCal(); });
    $("#cal-next").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 1); renderCal(); });
    $("#praymusic-btn").addEventListener("click", togglePrayMusic);
    $("#pm-play").addEventListener("click", togglePrayMusic);
    $("#pm-prev").addEventListener("click", () => _pmStep(-1));
    $("#pm-next").addEventListener("click", () => _pmStep(1));
    $("#pm-close").addEventListener("click", _pmStop);
    // ⏰ 기도시간 알림
    $("#settings-btn").addEventListener("click", openSettings);
    $("#settings-close").addEventListener("click", () => $("#settings-overlay").classList.remove("show"));
    $("#set-alarm-btn").addEventListener("click", () => { $("#settings-overlay").classList.remove("show"); openAlarmSheet(); });
    $("#alarm-save").addEventListener("click", savePrayAlarm);
    $("#alarm-cancel").addEventListener("click", () => $("#alarm-overlay").classList.remove("show"));
    syncPrayAlarms();   // 기도제목 개수가 바뀌었을 수 있으니 열 때마다 다시 건다
    $("#d-sharecard").addEventListener("click", shareCardFromDetail);
    $("#import-card-btn").addEventListener("click", () => $("#import-card-file").click());
    $("#import-card-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importCardFile(f);
      e.target.value = "";
    });
    $("#pin-ok").addEventListener("click", submitPin);
    // PIN 변경: 현재 PIN 확인 → 새 PIN 두 번 → 비밀 기도 전체 재암호화
    $("#set-pin-change").addEventListener("click", async () => {
      if (!PrayCrypt.isSetup()) { toast("아직 PIN이 설정되지 않았습니다"); return; }
      try {
        if (!PrayCrypt.isUnlocked()) {
          const cur = prompt("현재 PIN을 입력해 주세요"); if (cur === null) return;
          await PrayCrypt.unlock(cur);
        }
        const p1 = prompt("새 PIN (4자리 이상)"); if (p1 === null) return;
        if (!p1 || p1.length < 4) { toast("PIN은 4자리 이상이어야 합니다"); return; }
        const p2 = prompt("새 PIN을 한 번 더"); if (p2 === null) return;
        if (p1 !== p2) { toast("두 입력이 서로 다릅니다"); return; }
        const n = await PrayCrypt.changePin(p1);
        closePin(); render();
        toast(`PIN이 변경되었습니다 (비밀 기도 ${n}건 다시 잠금) 🔒`);
      } catch (e) { toast(e.message); }
    });
    // PIN 분실: 키가 없으면 복구 불가 — 비밀 기도를 삭제하고 처음부터
    $("#set-pin-forgot").addEventListener("click", () => {
      if (!PrayCrypt.isSetup()) { toast("아직 PIN이 설정되지 않았습니다"); return; }
      const secretN = PrayStore.items().filter(x => x.secret).length;
      if (!confirm(`PIN 없이는 비밀 기도의 내용을 복구할 방법이 없습니다.\n초기화하면 비밀 기도 ${secretN}건이 영구 삭제되고, 새 PIN을 다시 설정할 수 있습니다.\n계속할까요?`)) return;
      if (!confirm("정말 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
      const n = PrayCrypt.resetForgotten();
      closePin(); render();
      toast(`초기화되었습니다 — 비밀 기도 ${n}건 삭제, 다음 🔒 저장 때 새 PIN을 정합니다`);
    });
    $("#pin-cancel").addEventListener("click", closePin);
    $("#pin-input").addEventListener("keydown", (e) => { if (e.key === "Enter") submitPin(); });
    $("#answered-filter").addEventListener("click", () => { showAnsweredOnly = !showAnsweredOnly; renderList(); });
    document.querySelectorAll("#f-slots button").forEach(b => b.addEventListener("click", () => b.classList.toggle("on")));
    $("#f-files").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (editingId) { for (const f of files) await AttachStore.add("pray:" + editingId, f); }
      else _pendingFiles.push(...files);
      e.target.value = "";
      renderAttach(editingId);
    });
    ["detail-overlay", "form-overlay", "pin-overlay"].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener("click", (e) => { if (e.target === el) el.classList.remove("show"); });
    });

    // 저장소 영구 보관 요청 — 브라우저 임의 삭제(eviction) 방지
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    // 읽기앱에서 "🙏 기도제목에"로 넘어온 경우: 약속말씀이 미리 채워진 폼 열기
    try {
      const draft = JSON.parse(sessionStorage.getItem("bible-pray-draft") || "null");
      if (draft) {
        sessionStorage.removeItem("bible-pray-draft");
        openForm(null).then(() => {
          $("#f-pref").value = draft.ref || "";
          $("#f-ptext").value = draft.text || "";
        });
      }
    } catch (e) {}

    setTab("today");
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
