// ============================================================================
// AlarmSync — 찬양이 울리는 알람을 안드로이드에 건다 (매일찬양·매일기도가 함께 쓴다)
// ----------------------------------------------------------------------------
// 알람 시각에는 안드로이드가 직접 곡을 튼다(PraiseAlarm·AlarmService) — 앱이 꺼져 있거나
// 화면이 잠겨 있으면 웹 쪽 음원 저장소(IndexedDB)를 꺼낼 수 없기 때문이다. 그래서 알람에 쓸 곡을
// 미리 앱 전용 폴더에 조각조각 복사해 두고(알람 하나에 SONGS_MAX 곡까지), 알람 목록을 넘긴다.
//
//   AlarmSync.available()                 안드로이드 앱인가(아니면 각 화면이 예전처럼 알림만 건다)
//   AlarmSync.sync(group, plan)           그 묶음("praise"·"pray")의 알람을 통째로 바꿔 건다
//       plan: [{ id, title, body, daily, hour, minute, days, at, songs:[곡 id], open:"화면.html?…" }]
//       days: 매일 알람이 울릴 요일 [0(일)…6(토)] — 없으면 날마다
//       곡을 하나도 못 옮긴 알람도 건다 — 그때는 기기의 기본 알람 소리로 울린다
//   AlarmSync.status()                    { exact, notify } — 제시각에 울리는가 · 끌 단추가 보이는가
//   AlarmSync.SONGS_MAX
//   AlarmSync.days — 요일 고르기(매일찬양 알람·매일기도 기도시간이 함께 쓴다)
//       ALL · normalize(days) · label(days) → "매일"·"평일"·"주말"·"월·수·금" · pickerHtml(days) · bindPicker(box, onChange)
// ============================================================================
const AlarmSync = (() => {
  const SONGS_MAX = 10;
  const CHUNK = 512 * 1024;   // 곡을 안드로이드 쪽으로 넘기는 조각 크기

  const plugin = () => {
    const P = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.PraiseAlarm;
    return P && typeof Capacitor.isNativePlatform === "function" && Capacitor.isNativePlatform() ? P : null;
  };
  const fileOf = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, "_");
  const blobBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  // 곡 하나를 조각조각 알람 폴더로 — 큰 곡도 메모리에 통째로 올리지 않는다
  async function copy(NA, name, blob) {
    const { handle } = await NA.writeBegin({ name });
    try {
      for (let off = 0; off < blob.size; off += CHUNK) {
        await NA.writeChunk({ handle, data: await blobBase64(blob.slice(off, off + CHUNK)) });
      }
      await NA.writeEnd({ handle });
    } catch (e) {
      NA.writeAbort({ handle }).catch(() => {});
      throw e;
    }
  }

  async function sync(group, plan, onCopying) {
    const NA = plugin();
    if (!NA) throw new Error("찬양 알람은 안드로이드 앱에서만 됩니다");
    const have = new Set(((await NA.files()) || {}).names || []);
    const need = [...new Set(plan.flatMap(p => p.songs || []))].filter(id => !have.has(fileOf(id)));
    let announced = false;
    for (const id of need) {
      const rec = await PraiseAudio.get(id).catch(() => null);
      if (!rec || !rec.blob) continue;
      if (!announced && onCopying) { onCopying(need.length); announced = true; }
      try { await copy(NA, fileOf(id), rec.blob); have.add(fileOf(id)); }
      catch (e) { console.warn("[알람] 곡을 복사하지 못했습니다", id, e); }
    }
    await NA.setAll({ group, alarms: plan.map(p => ({
      id: p.id, title: p.title, body: p.body, daily: p.daily, hour: p.hour, minute: p.minute, at: p.at,
      days: p.daily ? days.normalize(p.days) : undefined,
      open: p.open, files: (p.songs || []).map(fileOf).filter(n => have.has(n))
    })) });
  }

  // ── 요일 고르기 ── 0(일)…6(토), Date.getDay() 와 같은 번호. 저장은 늘 오름차순 배열
  const days = (() => {
    const ALL = [0, 1, 2, 3, 4, 5, 6];
    const NAMES = ["일", "월", "화", "수", "목", "금", "토"];
    const PRESETS = [["매일", ALL], ["평일", [1, 2, 3, 4, 5]], ["주말", [0, 6]]];
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    // 모르는 값·빈 배열·옛 알람(days 없음)은 날마다로 본다 — 아무 날도 안 울리는 알람은 만들지 않는다
    function normalize(d) {
      if (!Array.isArray(d)) return ALL.slice();
      const out = [...new Set(d.map(Number).filter(v => Number.isInteger(v) && v >= 0 && v <= 6))].sort((a, b) => a - b);
      return out.length ? out : ALL.slice();
    }
    function label(d) {
      const n = normalize(d);
      const p = PRESETS.find(([, v]) => same(v, n));
      if (p) return p[0];
      // 월요일부터 읽는 차례로 — "월·수·금", 일요일은 맨 뒤
      return [...n].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(v => NAMES[v]).join("·");
    }
    // 빠른 고르기(매일·평일·주말) + 요일 일곱 칸. 월요일부터 놓는다
    function pickerHtml(d) {
      const n = normalize(d);
      const quick = PRESETS.map(([name, v]) =>
        `<button type="button" class="dq${same(v, n) ? " on" : ""}" data-dq="${v.join(",")}">${name}</button>`).join("");
      const order = [1, 2, 3, 4, 5, 6, 0];
      const cells = order.map(v =>
        `<button type="button" class="dd${n.includes(v) ? " on" : ""}${v === 0 ? " sun" : v === 6 ? " sat" : ""}" data-dd="${v}" aria-pressed="${n.includes(v)}">${NAMES[v]}</button>`).join("");
      return `<div class="day-quick">${quick}</div><div class="day-cells">${cells}</div>`;
    }
    // 누를 때마다 새 요일 배열을 onChange 로 넘긴다. 마지막 하나는 끌 수 없다(아무 날도 안 울리면 알람이 아니다)
    function bindPicker(box, get, onChange) {
      box.querySelectorAll("[data-dq]").forEach(b => b.addEventListener("click", () => onChange(b.dataset.dq.split(",").map(Number))));
      box.querySelectorAll("[data-dd]").forEach(b => b.addEventListener("click", () => {
        const v = Number(b.dataset.dd), cur = normalize(get());
        const next = cur.includes(v) ? cur.filter(x => x !== v) : cur.concat(v);
        if (!next.length) { b.animate && b.animate([{ transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "none" }], 180); return; }
        onChange(normalize(next));
      }));
    }
    return { ALL, normalize, label, pickerHtml, bindPicker };
  })();

  async function status() {
    const NA = plugin();
    return NA ? NA.status().catch(() => null) : null;
  }

  return { available: () => !!plugin(), sync, status, SONGS_MAX, days };
})();
