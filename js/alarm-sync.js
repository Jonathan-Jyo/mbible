// ============================================================================
// AlarmSync — 찬양이 울리는 알람을 안드로이드에 건다 (매일찬양·매일기도가 함께 쓴다)
// ----------------------------------------------------------------------------
// 알람 시각에는 안드로이드가 직접 곡을 튼다(PraiseAlarm·AlarmService) — 앱이 꺼져 있거나
// 화면이 잠겨 있으면 웹 쪽 음원 저장소(IndexedDB)를 꺼낼 수 없기 때문이다. 그래서 알람에 쓸 곡을
// 미리 앱 전용 폴더에 조각조각 복사해 두고(알람 하나에 SONGS_MAX 곡까지), 알람 목록을 넘긴다.
//
//   AlarmSync.available()                 안드로이드 앱인가(아니면 각 화면이 예전처럼 알림만 건다)
//   AlarmSync.sync(group, plan)           그 묶음("praise"·"pray")의 알람을 통째로 바꿔 건다
//       plan: [{ id, title, body, daily, hour, minute, at, songs:[곡 id], open:"화면.html?…" }]
//       곡을 하나도 못 옮긴 알람도 건다 — 그때는 기기의 기본 알람 소리로 울린다
//   AlarmSync.status()                    { exact, notify } — 제시각에 울리는가 · 끌 단추가 보이는가
//   AlarmSync.SONGS_MAX
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
      open: p.open, files: (p.songs || []).map(fileOf).filter(n => have.has(n))
    })) });
  }

  async function status() {
    const NA = plugin();
    return NA ? NA.status().catch(() => null) : null;
  }

  return { available: () => !!plugin(), sync, status, SONGS_MAX };
})();
