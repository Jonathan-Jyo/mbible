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
  }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ── 비밀 항목 표시용: 잠금 상태별 제목 얻기 ──────────────────────────
  async function displayItem(item) {
    if (!item.secret) return item;
    const dec = await PrayCrypt.decryptItem(item);
    return dec || Object.assign({}, item, { title: "🔒 은밀한 기도", content: "", _locked: true });
  }

  // ── 탭 전환 ──────────────────────────────────────────────────────────
  function setTab(t) {
    tab = t;
    document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
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
    for (const [slot, label] of PrayStore.SLOTS) {
      const list = all.filter(x => (x.slots || []).includes(slot));
      html += `<div class="slot-sec"><div class="slot-head">${SLOT_ICON[slot]} ${label}기도 <span class="slot-cnt">${list.length}</span></div>`;
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
      html += `</div>`;
    }
    box.innerHTML = html;
    box.querySelectorAll(".chk").forEach(b => b.addEventListener("click", (e) => {
      const row = e.target.closest(".pray-row");
      const on = PrayStore.toggleLog(PrayStore.today(), row.dataset.slot, row.dataset.id);
      row.classList.toggle("done", on);
      e.target.textContent = on ? "✓" : "";
    }));
    box.querySelectorAll("[data-open]").forEach(el => el.addEventListener("click", () => openDetail(el.dataset.open)));
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
    if (!confirm("이 기도제목을 삭제할까요? (기도 기록은 남습니다)")) return;
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
    $("#f-secret").checked = !!it.secret;
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
    $("#d-close").addEventListener("click", closeDetail);
    $("#d-answer-btn").addEventListener("click", answerFromDetail);
    $("#d-edit-btn").addEventListener("click", editFromDetail);
    $("#d-del-btn").addEventListener("click", deleteFromDetail);
    $("#thanks-add").addEventListener("click", submitThanks);
    $("#thanks-input").addEventListener("keydown", (e) => { if (e.key === "Enter") submitThanks(); });
    $("#cal-prev").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() - 1, 1); renderCal(); });
    $("#cal-next").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 1); renderCal(); });
    $("#lock-btn").addEventListener("click", () => {
      if (PrayCrypt.isUnlocked()) { PrayCrypt.lock(); render(); toast("잠금되었습니다 🔒"); }
      else openPin(null);
    });
    $("#pin-ok").addEventListener("click", submitPin);
    // PIN 변경: 현재 PIN 확인 → 새 PIN 두 번 → 비밀 기도 전체 재암호화
    $("#pin-change").addEventListener("click", async () => {
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
    $("#pin-forgot").addEventListener("click", () => {
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
