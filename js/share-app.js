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
    const eff = s === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : s;
    document.documentElement.dataset.theme = eff;
    syncStatusBar(eff);
  }
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }

  const _byId = (id) => ShareStore.vips().find(x => x.id === id);

  // ── 🎂 생일 계산 (음력은 브라우저 내장 한국 음력 달력 ICU dangi 사용) ──
  const Lunar = (() => {
    let fmt = null;
    function ok() {
      if (fmt) return true;
      try { fmt = new Intl.DateTimeFormat("ko-u-ca-dangi", { month: "numeric", day: "numeric" }); return true; }
      catch (e) { return false; }
    }
    const lunarOf = (d) => {
      const o = {}; fmt.formatToParts(d).forEach(p => { o[p.type] = p.value; });
      const leap = String(o.month).startsWith("윤");        // ICU가 윤달을 "윤2"로 표기
      return { m: parseInt(String(o.month).replace("윤", "")), d: parseInt(o.day), leap };
    };
    // 해당 양력 연도에서 음력 m/d(윤달 여부 포함)에 해당하는 날짜.
    // 윤달 생인데 그 해에 윤달이 없으면 평달 날짜로 대신하고 fallback 표시
    function solarForLunar(lm, ld, solarYear, wantLeap) {
      if (!ok()) return null;
      let plain = null;
      for (let ts = Date.UTC(solarYear, 0, 1); ts <= Date.UTC(solarYear, 11, 31); ts += 86400000) {
        const d = new Date(ts);
        const l = lunarOf(d);
        if (l.m === lm && l.d === ld) {
          if (!!l.leap === !!wantLeap) return { date: d, fallback: false };
          if (!l.leap && !plain) plain = d;
        }
      }
      return plain ? { date: plain, fallback: true } : null;
    }
    return { ok, solarForLunar };
  })();

  const _parseBirth = (str) => {
    const m = String(str || "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  };
  const _fullAge = (solarDate) => {
    const now = new Date();
    let age = now.getFullYear() - solarDate.getFullYear();
    if (now.getMonth() < solarDate.getMonth() ||
        (now.getMonth() === solarDate.getMonth() && now.getDate() < solarDate.getDate())) age--;
    return age;
  };
  // 표시 문구: "1980-03-05 (음력) · 올해 생일(양력) 4.12 · 만 46세"
  function birthInfoText(birth, cal) {
    const b = _parseBirth(birth);
    if (!b) return esc(birth);
    const isLeap = cal === "음력(윤달)";
    const isLunar = cal === "음력" || isLeap;
    let solarBirth = new Date(b.y, b.m - 1, b.d);
    let extra = "";
    if (isLunar && Lunar.ok()) {
      const sb = Lunar.solarForLunar(b.m, b.d, b.y, isLeap);
      if (sb) solarBirth = sb.date;                         // 만나이는 태어난 해의 양력 환산일 기준
      const ty = Lunar.solarForLunar(b.m, b.d, new Date().getFullYear(), isLeap);
      if (ty) extra = ` · 올해 생일(양력) ${ty.date.getMonth() + 1}.${ty.date.getDate()}${isLeap && ty.fallback ? " (올해는 윤달 없음 — 평달 기준)" : ""}`;
    }
    const calLabel = isLeap ? "음력 윤달" : (isLunar ? "음력" : "양력");
    return `${esc(birth)} (${calLabel})${extra} · 만 ${_fullAge(solarBirth)}세`;
  }
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
    $("#d-name").textContent = "💝 " + v.name + (v.gender ? ` (${v.gender})` : "");
    $("#d-meta").innerHTML =
      ShareStore.STAGES.map((s, i) => `<span class="stg${i <= stageIdx(v.stage) ? " on" : ""}" data-stage="${s}">${s}</span>`).join("<span class='stg-sep'>›</span>") +
      (v.family ? `<div style="font-size:12px;color:var(--dim);margin-top:4px">👨‍👩‍👧 가족대표: ${esc(v.family)}</div>` : "") +
      `<div class="item-tags">${(v.tags || []).map(t => `<span class="htag">#${esc(t)}</span>`).join("")}</div>`;

    // 🔒 연락처 — 잠금 해제 시에만
    const box = $("#d-contact");
    if (!v.enc) box.innerHTML = `<div class="c-line dim">저장된 연락처가 없습니다</div>`;
    else if (!ShareCrypt.isUnlocked()) box.innerHTML = `<button class="btn-ghost w100" id="d-unlock">🔒 연락처 보기 (PIN)</button>`;
    else {
      const c = await ShareCrypt.decObj(v.enc) || {};
      box.innerHTML =
        [c.phone && `<div class="c-line">📞 ${esc(c.phone)} <a class="c-act" href="tel:${esc(c.phone)}">전화</a><a class="c-act" href="sms:${esc(c.phone)}">문자</a></div>`,
         c.email && `<div class="c-line">✉️ ${esc(c.email)}</div>`,
         c.birth && `<div class="c-line">🎂 ${birthInfoText(c.birth, c.birthCal)}</div>`,
         c.addr && `<div class="c-line">🏠 ${esc(c.addr)}</div>`,
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
    // 제목 규칙: 첫 태그가 있으면 "OOO 님의 <태그>", 없으면 "OOO 님을 위하여"
    // (이름에서 자동 생성된 태그는 제외 — "한무홍 님의 한무홍" 방지)
    const firstTag = (v.tags || []).find(t => t && t !== v.name && !v.name.includes(t) && !t.includes(v.name));
    const prayTitle = firstTag ? `${v.name} 님의 ${firstTag}` : `${v.name} 님을 위하여`;
    // 카드의 태그도 물려줘 같은 말(#건강회복)로 기도·나눔이 함께 검색되게 한다
    const item = PrayStore.add({ target: "VIP", type: "도고", title: prayTitle, person: v.name,
      slots: ["dawn"], tags: Array.from(new Set(["VIP", v.name, ...(v.tags || [])])) });
    ShareStore.update(id, { prayId: item.id });
    toast("매일기도에 VIP 기도제목이 생겼습니다 🙏");
    openDetail(id);
  }

  // ── 💌 VIP카드 보내기·받기 ───────────────────────────────────────────
  async function shareCardFromDetail() {
    const id = $("#detail-overlay").dataset.id;
    const v = _byId(id); if (!v) return;
    let secret = {};
    if (v.enc) {
      if (!ShareCrypt.isUnlocked()) { openPin(() => shareCardFromDetail()); return; }   // 내 PIN 승인
      secret = await ShareCrypt.decObj(v.enc) || {};
    }
    const pass = prompt("전달용 비밀번호를 정해 주세요 (4자리 이상).\n받는 분께는 파일과 다른 길(전화·말)로 알려 주세요.");
    if (pass === null) return;
    if (!pass || pass.length < 4) { toast("전달용 비밀번호는 4자리 이상이어야 합니다"); return; }
    const payload = { name: v.name, stage: v.stage, tags: v.tags || [], family: v.family || "", gender: v.gender || "",
      secret: Object.values(secret).some(Boolean) ? secret : null };
    try {
      const json = await CardExchange.pack("vip", payload, pass);
      const how = await CardExchange.shareFile(`VIP카드_${CardExchange.safeName(v.name)}.json`, json, "VIP카드");
      toast(how === "shared" ? "VIP카드를 보냈습니다 💌" : "VIP카드 파일을 내려받았습니다 — 전달해 주세요");
    } catch (e) { toast("보내기 실패: " + e.message); }
  }

  let _pendingImport = null;
  async function importCardFile(file) {
    let parsed;
    try {
      const text = await file.text();
      const pass = prompt("보낸 분께 들은 전달용 비밀번호를 입력해 주세요.");
      if (pass === null) return;
      parsed = await CardExchange.unpack(text, pass);
    } catch (e) { toast(e.message); return; }
    if (parsed.kind !== "vip") { toast("이 파일은 기도카드입니다 — 매일기도의 [📥 카드 받기]에서 열어 주세요"); return; }
    const p = parsed.payload;
    if (!confirm(`「${p.name}」 VIP카드를 추가할까요?${p.secret ? "\n(연락처는 내 PIN으로 잠가 저장됩니다)" : ""}`)) return;
    _pendingImport = p;
    finishImport();
  }
  async function finishImport() {
    const p = _pendingImport; if (!p) return;
    let encBlob = null;
    if (p.secret) {
      if (!ShareCrypt.isSetup()) {
        const pin = prompt("연락처를 잠글 내 PIN(4자리 이상)을 처음 설정합니다.\n비밀기도 PIN과는 별개입니다.\n⚠️ PIN을 잊으면 복구할 수 없습니다.");
        if (!pin || pin.length < 4) { toast("PIN 설정이 취소되어 카드를 저장하지 않았습니다"); _pendingImport = null; return; }
        await ShareCrypt.setup(pin);
      }
      if (!ShareCrypt.isUnlocked()) { openPin(() => finishImport()); return; }
      encBlob = await ShareCrypt.encObj(p.secret);          // 받는 사람의 PIN으로 다시 잠금
    }
    ShareStore.add({ name: p.name, stage: p.stage, tags: p.tags, family: p.family, gender: p.gender }, encBlob);
    _pendingImport = null;
    render();
    toast(`VIP카드가 추가되었습니다 💝${p.secret ? " (내 PIN으로 잠금)" : ""}`);
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
    let v = { name: "", stage: "관심", tags: [], family: "", gender: "" }, c = {};
    if (id) {
      v = _byId(id) || v;
      if (v.enc) {
        if (!ShareCrypt.isUnlocked()) { openPin(() => openForm(id)); return; }
        c = await ShareCrypt.decObj(v.enc) || {};
      }
    }
    $("#f-name").value = v.name; $("#f-stage").value = v.stage;
    $("#f-family").value = v.family || ""; $("#f-gender").value = v.gender || "";
    $("#f-phone").value = c.phone || "";
    $("#f-email").value = c.email || ""; $("#f-birth").value = c.birth || "";
    $("#f-addr").value = c.addr || "";
    $("#f-birthcal").value = ["음력", "음력(윤달)"].includes(c.birthCal) ? c.birthCal : "양력";
    $("#f-memo").value = c.memo || "";
    $("#f-tags").value = BibleTags.toInput(v.tags || []);
    $("#form-overlay").classList.add("show");
    // 자동 포커스 없음 — 안드로이드 IME 안정성 (사용자 탭으로 포커스)
  }
  function closeForm() { $("#form-overlay").classList.remove("show"); editingId = null; }

  async function saveForm() {
    const name = $("#f-name").value.trim();
    if (!name) { toast("이름을 입력해 주세요"); return; }
    const secret = {
      phone: $("#f-phone").value.trim(),
      email: $("#f-email").value.trim(),
      birth: $("#f-birth").value.trim(),
      birthCal: $("#f-birthcal").value,
      addr: $("#f-addr").value.trim(),
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
      family: $("#f-family").value.trim(), gender: $("#f-gender").value,
      tags: userTags.length ? userTags : BibleTags.auto([name, $("#f-stage").value])
    };
    const encBlob = hasSecret ? await ShareCrypt.encObj(secret) : null;

    if (editingId) ShareStore.update(editingId, Object.assign({}, data, { enc: encBlob }));
    else ShareStore.add(data, encBlob);
    closeForm(); render(); toast(editingId ? "수정되었습니다" : "VIP 카드가 만들어졌습니다 💝");
  }

  // ── 📇 휴대폰 연락처에서 불러오기 (APK: 네이티브 선택창 / 웹: 크롬 연락처 API) ──
  async function pickContact() {
    // ① APK — @capacitor-community/contacts
    const CT = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Contacts;
    if (CT) {
      try {
        const perm = await CT.requestPermissions();
        if (perm && perm.contacts === "denied") { toast("연락처 권한이 거부되었습니다 — 설정에서 허용해 주세요"); return; }
        const res = await CT.pickContact({ projection: { name: true, phones: true, emails: true, birthday: true, postalAddresses: true } });
        const c = res && res.contact;
        if (!c) return;
        _fillFromContact({
          name: c.name && (c.name.display || [c.name.family, c.name.given].filter(Boolean).join("")),
          phone: c.phones && c.phones[0] && c.phones[0].number,
          email: c.emails && c.emails[0] && c.emails[0].address,
          birthday: c.birthday,
          addr: c.postalAddresses && c.postalAddresses[0] &&
            (c.postalAddresses[0].formatted ||
             [c.postalAddresses[0].region, c.postalAddresses[0].city, c.postalAddresses[0].street].filter(Boolean).join(" "))
        });
        return;
      } catch (e) { toast("연락처를 불러오지 못했습니다: " + (e.message || e)); return; }
    }
    // ② 웹 — Contact Picker API (안드로이드 크롬)
    if (navigator.contacts && navigator.contacts.select) {
      try {
        const picked = await navigator.contacts.select(["name", "tel", "email", "address"], { multiple: false });
        const c = picked && picked[0];
        if (!c) return;
        _fillFromContact({
          name: c.name && c.name[0], phone: c.tel && c.tel[0], email: c.email && c.email[0],
          addr: c.address && c.address[0] && (c.address[0].formatted || "")
        });
      } catch (e) {}
      return;
    }
    toast("이 환경에서는 연락처 불러오기를 지원하지 않습니다 — 앱(APK)에서 사용해 주세요");
  }
  function _fillFromContact(c) {
    const fill = (sel, v) => { const el = $(sel); if (v && !el.value.trim()) el.value = String(v).trim(); };
    fill("#f-name", c.name);
    fill("#f-phone", c.phone);
    fill("#f-email", c.email);
    fill("#f-addr", c.addr);
    if (c.birthday && c.birthday.month && c.birthday.day) {
      const y = c.birthday.year;
      const p = (n) => String(n).padStart(2, "0");
      fill("#f-birth", y ? `${y}-${p(c.birthday.month)}-${p(c.birthday.day)}` : `${p(c.birthday.month)}-${p(c.birthday.day)}`);
    }
    toast("연락처에서 채웠습니다 — 확인 후 저장해 주세요 📇");
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
    BibleTags.hardenInputs();
    attachSheetCloseButtons();   // 모든 보조창 오른쪽 위에 ✕
    $("#form-save").addEventListener("click", saveForm);
    $("#f-pick-contact").addEventListener("click", pickContact);
    $("#d-sharecard").addEventListener("click", shareCardFromDetail);
    $("#import-card-btn").addEventListener("click", () => $("#import-card-file").click());
    $("#import-card-file").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importCardFile(f);
      e.target.value = "";
    });
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
