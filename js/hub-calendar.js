// ============================================================================
// HubCalendar — 허브(index.html) 종합달력 · 대시보드
// ----------------------------------------------------------------------------
// 원칙: 각 앱의 달력은 자기 활동을 자세히, 종합달력은 다섯 앱을 요약해서.
//  · 날짜마다 앱별 색점으로 활동 표시
//  · 날짜를 누르면 앱별 활동 요약 행 → 행을 누르면 해당 앱으로 이동
//  · 상단에 이번 달 대시보드(앱별 활동 일수·연속 기록)
//  · 찬양·나눔은 소스만 등록하면 자동 확장 (SOURCES 배열)
// ============================================================================

const HubCalendar = (() => {
  const _get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  const _p = (n) => String(n).padStart(2, "0");
  const _day = (d) => `${d.getFullYear()}-${_p(d.getMonth() + 1)}-${_p(d.getDate())}`;
  const SLOT_KO = { dawn: "새벽", noon: "점심", eve: "저녁" };

  // ── 앱별 소스: byDay()가 {"YYYY-MM-DD": 요약객체}를 돌려준다 ──────────
  const SOURCES = [
    {
      key: "read", label: "성경읽기", icon: "📖", color: "#4a9fd8", href: "reader.html",
      byDay() {
        const t = _get("bible-reader-tongdok", {});
        const out = {};
        for (const d in (t.daily || {})) { const n = (t.daily[d] || []).length; if (n) out[d] = { text: `${n}장 읽음` }; }
        return out;
      }
    },
    {
      key: "memo", label: "성경암송", icon: "✦", color: "#d9b45b", href: "key.html",
      byDay() {
        const m = _get("bible-memo-daily", {});
        const out = {};
        for (const d in m) { const n = (m[d] || []).length; if (n) out[d] = { text: `${n}회 암송 체크` }; }
        return out;
      }
    },
    {
      key: "pray", label: "매일기도", icon: "🙏", color: "#9d7ae8", href: "pray.html",
      byDay() {
        const log = _get("bible-pray-log", {});
        const answered = {};   // 날짜별 응답 건수
        for (const it of _get("bible-pray-items", [])) if (it && it.answeredAt) answered[it.answeredAt] = (answered[it.answeredAt] || 0) + 1;
        const out = {};
        for (const d in log) {
          const slots = Object.keys(log[d]).filter(s => (log[d][s] || []).length);
          if (!slots.length) continue;
          const total = slots.reduce((a, s) => a + log[d][s].length, 0);
          out[d] = { text: `${slots.map(s => SLOT_KO[s] || s).join("·")} 기도 (${total}제목)` };
        }
        for (const d in answered) {
          const base = out[d] ? out[d].text + " · " : "";
          out[d] = { text: `${base}응답 ${answered[d]}건 🎉` };
        }
        return out;
      }
    },
    {
      key: "thanks", label: "감사노트", icon: "🧡", color: "#e8875a", href: "pray.html",
      byDay() {
        const out = {};
        for (const t of _get("bible-pray-thanks", [])) {
          if (!t || !t.date) continue;
          out[t.date] = out[t.date] || { n: 0, text: "" };
          out[t.date].n++;
          out[t.date].text = `감사 ${out[t.date].n}건`;
        }
        return out;
      }
    },
    {
      key: "praise", label: "매일찬양", icon: "🎵", color: "#5ec9a8", href: "praise.html",
      byDay() {
        const log = _get("bible-praise-log", {});
        const out = {};
        for (const d in log) { const n = (log[d] || []).length; if (n) out[d] = { text: `찬양 ${n}곡 들음` }; }
        return out;
      }
    },
    {
      key: "share", label: "매일나눔", icon: "💝", color: "#e88bb0", href: "share.html",
      byDay() {
        const out = {};
        for (const l of _get("bible-share-log", [])) {
          if (!l || !l.date) continue;
          out[l.date] = out[l.date] || { n: 0 };
          out[l.date].n++;
          out[l.date].text = `나눔 ${out[l.date].n}건`;
        }
        return out;
      }
    }
  ];

  let _y = null, _m = null, _picked = null, _root = null;

  function _streak(byDay) {
    let n = 0; const cur = new Date();
    if (!byDay[_day(cur)]) cur.setDate(cur.getDate() - 1);
    while (byDay[_day(cur)]) { n++; cur.setDate(cur.getDate() - 1); }
    return n;
  }

  function open(rootEl) {
    _root = rootEl;
    const now = new Date();
    if (_y == null) { _y = now.getFullYear(); _m = now.getMonth(); }
    _picked = null;
    render();
  }

  function shift(d) { _m += d; if (_m < 0) { _m = 11; _y--; } if (_m > 11) { _m = 0; _y++; } _picked = null; render(); }
  function pick(day) { _picked = _picked === day ? null : day; render(); }

  function render() {
    if (!_root) return;
    const data = SOURCES.map(s => ({ s, byDay: s.byDay() }));
    const today = _day(new Date());
    const monthKey = `${_y}-${_p(_m + 1)}`;
    const startDow = new Date(_y, _m, 1).getDay();
    const days = new Date(_y, _m + 1, 0).getDate();

    // ── 대시보드: 앱별 이번 달 활동 일수 + 연속 기록 ──
    const dash = data.map(({ s, byDay }) => {
      const monthDays = Object.keys(byDay).filter(k => k.startsWith(monthKey)).length;
      const streak = _streak(byDay);
      return `<div class="hcal-stat" style="border-color:${s.color}55">
        <span class="hs-ico">${s.icon}</span><span class="hs-name">${s.label}</span>
        <b>${monthDays}일</b>${streak > 1 ? `<span class="hs-streak">🔥${streak}일 연속</span>` : ""}</div>`;
    }).join("");

    // ── 달력 그리드 ──
    let cells = ["일", "월", "화", "수", "목", "금", "토"].map((d, i) =>
      `<div class="hcal-dow${i === 0 ? " sun" : ""}">${d}</div>`).join("");
    for (let i = 0; i < startDow; i++) cells += `<div></div>`;
    for (let d = 1; d <= days; d++) {
      const key = `${monthKey}-${_p(d)}`;
      const dots = data.filter(x => x.byDay[key]).map(x => `<i style="background:${x.s.color}"></i>`).join("");
      cells += `<div class="hcal-cell${key === today ? " today" : ""}${_picked === key ? " picked" : ""}" data-day="${key}">
        <span>${d}</span><div class="hdots">${dots}</div></div>`;
    }

    // ── 선택한 날의 앱별 요약 (행 클릭 → 해당 앱) ──
    let detail = "";
    if (_picked) {
      const rows = data.filter(x => x.byDay[_picked]).map(x =>
        `<a class="hcal-row" href="${x.s.href}">
           <span class="hr-ico" style="color:${x.s.color}">${x.s.icon}</span>
           <span class="hr-name">${x.s.label}</span>
           <span class="hr-text">${x.byDay[_picked].text}</span>
           <span class="hr-go">앱에서 자세히 ›</span></a>`).join("");
      detail = `<div class="hcal-detail"><div class="hd-date">${_picked.replace(/-/g, ".")}</div>
        ${rows || `<div class="hd-empty">이날은 기록이 없습니다</div>`}</div>`;
    }

    _root.innerHTML = `
      <div class="hcal-head">
        <button data-nav="-1">◀</button><b>${_y}년 ${_m + 1}월</b><button data-nav="1">▶</button>
      </div>
      <div class="hcal-dash">${dash}</div>
      <div class="hcal-grid">${cells}</div>
      ${detail}`;

    _root.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => shift(+b.dataset.nav)));
    _root.querySelectorAll("[data-day]").forEach(c => c.addEventListener("click", () => pick(c.dataset.day)));
  }

  return { open, SOURCES };
})();
