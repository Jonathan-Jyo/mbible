// ============================================================================
// share-app — 매일나눔 UI (share.html 전용)
// 화면: 오늘의 나눔(오래된 순) · VIP 카드 · 달력  +  🔒 연락처 암호화(별도 PIN)
// 나눔: 말씀카드(기억절 텍스트 공유) · 찬양 보내기 · 전화 · 문자 → 기록 자동 적립
// ============================================================================

(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let tab = "today";
  let calBase = new Date(), _calPicked = null;
  let editingId = null;

  function applyScheme() {
    let s = "dark";
    try { s = localStorage.getItem("bible-color-scheme") || "system"; } catch (e) {}
    document.documentElement.dataset.theme =
      s === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : s;
  }
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  const _byId = (id) => ShareStore.vips().find(x => x.id === id);
  const stageIdx = (s) => Math.max(0, ShareStore.STAGES.indexOf(s));

  // ── 탭 ───────────────────────────────────────────────────────────────
  function setTab(t) {
    tab = t;
    document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("show", p.id === "page-" + t));
    render();
  }
  function render() {
    if (tab === "today") renderToday();
    else if (tab === "vips") renderVips();
    else if (tab === "cal") renderCal();
  }

  function _rowHtml(v) {
    const last = ShareStore.lastShared(v.id);
    const days = ShareStore.daysSince(last);
    const dayText = last ? (days === 0 ? "오늘 나눔 ✓" : `마지막 나눔 ${days}일 전`) : "아직 나눔 기록이 없습니다";
    const prog = Math.round(((stageIdx(v.stage) + 1) / ShareStore.STAGES.length) * 100);
    return `<div class="vip-row" data-open="${v.id}">
      <div class="vip-main">
        <div class="vip-name">💝 ${esc(v.name)} <span class="tag">${esc(v.stage)}</span></div>
        <div class="vip-sub${days != null && days >= 7 ? " overdue" : ""}">${dayText}</div>
        <div class="stage-bar"><i style="width:${prog}%"></i></div>
      </div></div>`;
  }

  // ── ① 오늘의 나눔: 오래 연락 못 한 분이 위로 ────────────────────────
  function renderToday() {
    const box = $("#today-body");
    const arr = ShareStore.vips().slice().sort((a, b) => {
      const da = ShareStore.lastShared(a.id) || "0000", db = ShareStore.lastShared(b.id) || "0000";
      return da.localeCompare(db);
    });
    box.innerHTML = arr.length
      ? `<div class="slot-head">💝 마음을 쓸 순서 <span class="slot-cnt">${arr.length}명</span></div>` + arr.map(_rowHtml).join("")
      : `<div class="empty-line" style="margin-top:40px">＋ 버튼으로 첫 VIP 카드를 만들어 보세요<br><span style="font-size:12px">연락처는 암호화되어 이 기기에만 저장됩니다</span></div>`;
    box.querySelectorAll("[data-open]").forEach(el => el.addEventListener("click", () => openDetail(el.dataset.open)));
  }

  // ── ② VIP 카드 목록 (단계별 그룹) ────────────────────────────────────
  function renderVips() {
    const box = $("#vips-body");
    const arr = ShareStore.vips();
    let html = "";
    for (const st of ShareStore.STAGES) {
      const list = arr.filter(x => x.stage === st);
      if (!list.length) continue;
      html += `<div class="grp"><div class="grp-head">${st} <span class="slot-cnt">${list.length}</span></div>` + list.map(_rowHtml).join("") + `</div>`;
    }
    box.innerHTML = html || `<div class="empty-line" style="margin-top:40px">아직 VIP 카드가 없습니다</div>`;
    box.querySelectorAll("[data-open]").forEach(el => el.addEventListener("click", () => openDetail(el.dataset.open)));
  }

  // ── 상세 ─────────────────────────────────────────────────────────────
  async function openDetail(id) {
    const v = _byId(id); if (!v) return;
    $("#d-name").textContent = "💝 " + v.name;
    $("#d-meta").innerHTML =
      ShareStore.STAGES.map((s, i) => `<span class="stg${i <= stageIdx(v.stage) ? " on" : ""}" data-stage="${s}">${s}</span>`).join("<span class='stg-sep'>›</span>") +
      `<div class="item-tags">${(v.tags || []).map(t => `<span class="htag">#${esc(t)}</span>`).join("")}</div>`;

    // 🔒 연락처 — 잠금 해제 시에만
    const box = $("#d-contact");
    if (!v.enc) box.innerHTML = `<div class="c-line dim">저장된 연락처가 없습니다</div>`;
    else if (!ShareCrypt.isUnlocked()) box.innerHTML = `<button class="btn-ghost w100" id="d-unlock">🔒 연락처 보기 (PIN)</button>`;
    else {
      const c = await ShareCrypt.decObj(v.enc) || {};
      box.innerHTML =
        [c.phone && `<div class="c-line">📞 ${esc(c.phone)} <a class="c-act" href="tel:${esc(c.phone)}">전화</a><a class="c-act" href="sms:${esc(c.phone)}">문자</a></div>`,
         c.kakao && `<div class="c-line">💬 카톡 ${esc(c.kakao)}</div>`,
         c.email && `<div class="c-line">✉️ ${esc(c.email)}</div>`,
         c.birth && `<div class="c-line">🎂 ${esc(c.birth)}</div>`,
         c.memo && `<div class="c-line memo">${esc(c.memo)}</div>`].filter(Boolean).join("") ||
        `<div class="c-line dim">저장된 연락처가 없습니다</div>`;
    }
    const ub = $("#d-unlock");
    if (ub) ub.addEventListener("click", () => openPin(() => openDetail(id)));

    // 단계 탭 (누르면 이동)
    $("#d-meta").querySelectorAll("[data-stage]").forEach(el => el.addEventListener("click", () => {
      ShareStore.update(id, { stage: el.dataset.stage });
      toast(`단계: ${el.dataset.stage}`);
      openDetail(id); render();
    }));

    // 이 분과의 나눔 기록
    const logs = ShareStore.log().filter(x => x.vipId === id).slice().reverse().slice(0, 20);
    $("#d-log").innerHTML = logs.length
      ? `<div class="d-sec">최근 나눔</div>` + logs.map(l => `<div class="log-line">${esc(l.date)} · ${esc(l.method)}${l.memo ? " — " + esc(l.memo) : ""}</div>`).join("")
      : "";
    $("#d-pray").textContent = v.prayId ? "🙏 기도제목 연결됨" : "🙏 이 분을 위한 기도제목 만들기";
    $("#detail-overlay").dataset.id = id;
    $("#detail-overlay").classList.add("show");
  }
  function closeDetail() { $("#detail-overlay").classList.remove("show"); }

  // ── 나눔하기 ─────────────────────────────────────────────────────────
  // ✦ 말씀카드: 기억절을 골라 이미지 카드 합성기(CardComposer)로 "그림 위에 말씀"
  //   — 합성기 안의 공유 버튼이 네이티브 공유시트(카톡 등)로 이어진다
  async function shareVerse() {
    const id = $("#detail-overlay").dataset.id;
    const uv = (() => { try { return JSON.parse(localStorage.getItem("bible-user-verses") || "[]"); } catch (e) { return []; } })();
    if (!uv.length) { toast("먼저 성경암송에서 기억절을 저장해 주세요"); return; }
    const pick = prompt("보낼 말씀을 선택하세요 (번호):\n" + uv.slice(0, 30).map((v, i) => `${i + 1}. ${v.topic || v.reference}`).join("\n"), "1");
    if (pick === null) return;
    const v = uv[parseInt(pick, 10) - 1];
    if (!v) { toast("번호를 다시 확인해 주세요"); return; }
    if (typeof CardComposer !== "undefined") {
      closeDetail();
      CardComposer.open({ verseText: v.verse || "", verseRef: v.reference || "" });
      ShareStore.addLog(id, "말씀카드", v.reference);
      toast("카드를 꾸며 공유해 보세요 — 나눔 기록에 남겼습니다 ✦");
    } else {
      // 합성기를 못 불러온 예외 상황: 텍스트 공유로 대신한다
      const text = `"${v.verse}"\n(${v.reference})`;
      try {
        if (navigator.share) await navigator.share({ title: v.topic || v.reference, text });
        else { await navigator.clipboard.writeText(text); toast("말씀이 복사되었습니다 — 붙여넣어 보내세요"); }
        ShareStore.addLog(id, "말씀카드", v.reference);
        toast("나눔 기록에 남겼습니다 ✦"); openDetail(id);
      } catch (e) {}
    }
  }

  async function sharePraise() {
    const id = $("#detail-overlay").dataset.id;
    const items = (() => { try { return JSON.parse(localStorage.getItem("bible-praise-items") || "[]"); } catch (e) { return []; } })();
    const withLink = items.filter(x => x.youtube);
    if (!withLink.length) { toast("유튜브 링크가 있는 찬양이 없습니다 — 매일찬양에서 담아 주세요"); return; }
    const pick = prompt("보낼 찬양을 선택하세요 (번호):\n" + withLink.slice(0, 30).map((v, i) => `${i + 1}. ${v.title}`).join("\n"), "1");
    if (pick === null) return;
    const p = withLink[parseInt(pick, 10) - 1];
    if (!p) { toast("번호를 다시 확인해 주세요"); return; }
    try {
      if (navigator.share) await navigator.share({ title: p.title, text: `${p.title}\n${p.youtube}`, url: p.youtube });
      else { await navigator.clipboard.writeText(`${p.title}\n${p.youtube}`); toast("찬양 링크가 복사되었습니다"); }
      ShareStore.addLog(id, "찬양", p.title);
      toast("나눔 기록에 남겼습니다 🎵"); openDetail(id);
    } catch (e) {}
  }

  function addLogManual() {
    const id = $("#detail-overlay").dataset.id;
    const m = prompt(`나눔 방법을 입력하세요:\n(${ShareStore.METHODS.join(" · ")})`, "전화");
    if (m === null) return;
    const memo = prompt("한 줄 메모 (선택)", "") || "";
    ShareStore.addLog(id, m.trim(), memo);
    toast("나눔 기록에 남겼습니다 💝"); openDetail(id); render();
  }

  function linkPray() {
    const id = $("#detail-overlay").dataset.id;
    const v = _byId(id); if (!v) return;
    if (v.prayId) { location.href = "pray.html"; return; }
    // PrayStore는 최상위 const라 window에 붙지 않는다 — typeof로 확인 (BibleDB 때와 같은 함정)
    if (typeof PrayStore === "undefined") { toast("기도 모듈을 불러오지 못했습니다"); return; }
    const item = PrayStore.add({ target: "VIP", type: "도고", title: `${v.name}을(를) 위하여`, slots: ["dawn"], tags: ["VIP", v.name] });
    ShareStore.update(id, { prayId: item.id });
    toast("매일기도에 VIP 기도제목이 생겼습니다 🙏");
    openDetail(id);
  }

  function deleteFromDetail() {
    const id = $("#detail-overlay").dataset.id;
    if (!confirm("이 VIP 카드를 삭제할까요? (나눔 기록도 함께 지워집니다)")) return;
    ShareStore.remove(id);
    closeDetail(); render(); toast("삭제되었습니다");
  }

  // ── 추가/수정 폼 ─────────────────────────────────────────────────────
  async function openForm(id) {
    editingId = id || null;
    $("#form-title").textContent = id ? "VIP 카드 수정" : "VIP 카드 추가";
    $("#f-stage").innerHTML = ShareStore.STAGES.map(s => `<option>${s}</option>`).join("");
    let v = { name: "", stage: "관심", tags: [] }, c = {};
    if (id) {
      v = _byId(id) || v;
      if (v.enc) {
        if (!ShareCrypt.isUnlocked()) { openPin(() => openForm(id)); return; }
        c = await ShareCrypt.decObj(v.enc) || {};
      }
    }
    $("#f-name").value = v.name; $("#f-stage").value = v.stage;
    $("#f-phone").value = c.phone || ""; $("#f-kakao").value = c.kakao || "";
    $("#f-email").value = c.email || ""; $("#f-birth").value = c.birth || "";
    $("#f-memo").value = c.memo || "";
    $("#f-tags").value = BibleTags.toInput(v.tags || []);
    $("#form-overlay").classList.add("show");
    $("#f-name").focus();
  }
  function closeForm() { $("#form-overlay").classList.remove("show"); editingId = null; }

  async function saveForm() {
    const name = $("#f-name").value.trim();
    if (!name) { toast("이름을 입력해 주세요"); return; }
    const secret = {
      phone: $("#f-phone").value.trim(), kakao: $("#f-kakao").value.trim(),
      email: $("#f-email").value.trim(), birth: $("#f-birth").value.trim(),
      memo: $("#f-memo").value.trim()
    };
    const hasSecret = Object.values(secret).some(Boolean);

    if (hasSecret && !ShareCrypt.isSetup()) {
      const pin = prompt("나눔앱 전용 PIN(4자리 이상)을 처음 설정합니다.\n비밀기도의 PIN과는 별개입니다.\n⚠️ PIN을 잊으면 연락처는 복구할 수 없습니다.");
      if (!pin || pin.length < 4) { toast("PIN 설정이 취소되었습니다 — 연락처 없이 저장하려면 연락처 칸을 비워 주세요"); return; }
      await ShareCrypt.setup(pin);
      toast("나눔앱 PIN이 설정되었습니다 🔒");
    }
    if (hasSecret && !ShareCrypt.isUnlocked()) { openPin(() => saveForm()); return; }

    const userTags = BibleTags.fromInput($("#f-tags").value);
    const data = {
      name, stage: $("#f-stage").value,
      tags: userTags.length ? userTags : BibleTags.auto([name, $("#f-stage").value])
    };
    const encBlob = hasSecret ? await ShareCrypt.encObj(secret) : null;

    if (editingId) ShareStore.update(editingId, Object.assign({}, data, { enc: encBlob }));
    else ShareStore.add(data, encBlob);
    closeForm(); render(); toast(editingId ? "수정되었습니다" : "VIP 카드가 만들어졌습니다 💝");
  }

  function editFromDetail() { const id = $("#detail-overlay").dataset.id; closeDetail(); openForm(id); }

  // ── ③ 달력 ───────────────────────────────────────────────────────────
  function renderCal() {
    const y = calBase.getFullYear(), m = calBase.getMonth();
    $("#cal-title").textContent = `${y}년 ${m + 1}월`;
    const byDay = {};
    for (const l of ShareStore.log()) (byDay[l.date] = byDay[l.date] || []).push(l);
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    let html = ["일", "월", "화", "수", "목", "금", "토"].map(d => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < first; i++) html += `<div></div>`;
    const todayStr = ShareStore.today();
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      html += `<div class="cal-cell${key === todayStr ? " today" : ""}${_calPicked === key ? " picked" : ""}" data-day="${key}">
        <span>${d}</span><div class="cds">${byDay[key] ? `<i class="cd"></i>` : ""}</div></div>`;
    }
    $("#cal-grid").innerHTML = html;
    $("#cal-grid").querySelectorAll("[data-day]").forEach(c => c.addEventListener("click", () => {
      _calPicked = _calPicked === c.dataset.day ? null : c.dataset.day; renderCal();
    }));
    const monthDays = Object.keys(byDay).filter(k => k.startsWith(`${y}-${String(m + 1).padStart(2, "0")}`)).length;
    $("#cal-sum").textContent = `이 달에 ${monthDays}일 나눔`;
    const box = $("#cal-detail");
    if (!_calPicked) { box.innerHTML = ""; return; }
    const lines = (byDay[_calPicked] || []).map(l => {
      const v = _byId(l.vipId);
      return `<div class="cd-slot">💝 ${esc(v ? v.name : "(삭제된 카드)")} · ${esc(l.method)}${l.memo ? " — " + esc(l.memo) : ""}</div>`;
    });
    box.innerHTML = `<div class="cd-date">${_calPicked.replace(/-/g, ".")}</div>` +
      (lines.length ? lines.join("") : `<div class="cd-slot" style="color:var(--dim)">이날은 기록이 없습니다</div>`);
  }

  // ── 🔒 PIN ───────────────────────────────────────────────────────────
  let _pinNext = null;
  function openPin(next) {
    _pinNext = next || null;
    $("#pin-msg").textContent = ShareCrypt.isSetup()
      ? "연락처 열람을 위해 나눔앱 PIN을 입력해 주세요"
      : "아직 PIN이 없습니다 — VIP 카드에 연락처를 저장하면 설정됩니다";
    $("#pin-input").value = "";
    $("#pin-overlay").classList.add("show");
    $("#pin-input").focus();
  }
  function closePin() { $("#pin-overlay").classList.remove("show"); _pinNext = null; }
  async function submitPin() {
    try {
      await ShareCrypt.unlock($("#pin-input").value);
      $("#pin-overlay").classList.remove("show");
      toast("잠금이 해제되었습니다 🔓");
      const next = _pinNext; _pinNext = null;
      if (next) next(); else render();
    } catch (e) { toast(e.message); $("#pin-input").value = ""; $("#pin-input").focus(); }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && ShareCrypt.isUnlocked()) { ShareCrypt.lock(); render(); }
  });

  // ── 초기화 ───────────────────────────────────────────────────────────
  function init() {
    applyScheme();
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyScheme);
    document.querySelectorAll(".tabbar button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $("#add-btn").addEventListener("click", () => openForm(null));
    BibleTags.attachAutoHash($("#f-tags"));
    $("#form-save").addEventListener("click", saveForm);
    $("#form-cancel").addEventListener("click", closeForm);
    $("#d-close").addEventListener("click", closeDetail);
    $("#d-verse").addEventListener("click", shareVerse);
    $("#d-praise").addEventListener("click", sharePraise);
    $("#d-logbtn").addEventListener("click", addLogManual);
    $("#d-pray").addEventListener("click", linkPray);
    $("#d-edit").addEventListener("click", editFromDetail);
    $("#d-del").addEventListener("click", deleteFromDetail);
    $("#lock-btn").addEventListener("click", () => {
      if (ShareCrypt.isUnlocked()) { ShareCrypt.lock(); render(); toast("잠금되었습니다 🔒"); }
      else openPin(null);
    });
    $("#pin-ok").addEventListener("click", submitPin);
    // PIN 변경 — 모든 VIP 연락처 암호문을 새 키로 재암호화
    $("#pin-change").addEventListener("click", async () => {
      if (!ShareCrypt.isSetup()) { toast("아직 PIN이 설정되지 않았습니다"); return; }
      try {
        if (!ShareCrypt.isUnlocked()) {
          const cur = prompt("현재 PIN을 입력해 주세요"); if (cur === null) return;
          await ShareCrypt.unlock(cur);
        }
        const p1 = prompt("새 PIN (4자리 이상)"); if (p1 === null) return;
        if (!p1 || p1.length < 4) { toast("PIN은 4자리 이상이어야 합니다"); return; }
        const p2 = prompt("새 PIN을 한 번 더"); if (p2 === null) return;
        if (p1 !== p2) { toast("두 입력이 서로 다릅니다"); return; }
        let n = 0;
        await ShareCrypt.changePin(p1, async (decOld, encNew) => {
          const arr = ShareStore.vips();
          for (let i = 0; i < arr.length; i++) {
            if (!arr[i].enc) continue;
            const plain = await decOld(arr[i].enc);
            if (plain === null) continue;
            arr[i] = Object.assign({}, arr[i], { enc: await encNew(plain) });
            n++;
          }
          ShareStore.saveVips(arr);
        });
        closePin(); render();
        toast(`PIN이 변경되었습니다 (연락처 ${n}건 다시 잠금) 🔒`);
      } catch (e) { toast(e.message); }
    });
    // PIN 분실 — 연락처 암호문은 복구 불가이므로 삭제(카드·나눔기록은 유지)
    $("#pin-forgot").addEventListener("click", () => {
      if (!ShareCrypt.isSetup()) { toast("아직 PIN이 설정되지 않았습니다"); return; }
      const encN = ShareStore.vips().filter(x => x.enc).length;
      if (!confirm(`PIN 없이는 저장된 연락처를 복구할 방법이 없습니다.\n초기화하면 ${encN}명의 연락처·메모가 영구 삭제됩니다 (이름·단계·나눔기록은 유지).\n계속할까요?`)) return;
      if (!confirm("정말 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
      ShareStore.saveVips(ShareStore.vips().map(v => Object.assign({}, v, { enc: null })));
      ShareCrypt.reset();
      closePin(); render();
      toast(`초기화되었습니다 — 다음 연락처 저장 때 새 PIN을 정합니다`);
    });
    $("#pin-cancel").addEventListener("click", closePin);
    $("#pin-input").addEventListener("keydown", (e) => { if (e.key === "Enter") submitPin(); });
    $("#cal-prev").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() - 1, 1); renderCal(); });
    $("#cal-next").addEventListener("click", () => { calBase = new Date(calBase.getFullYear(), calBase.getMonth() + 1, 1); renderCal(); });
    ["detail-overlay", "form-overlay", "pin-overlay"].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener("click", (e) => { if (e.target === el) el.classList.remove("show"); });
    });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    setTab("today");
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
