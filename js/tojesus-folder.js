"use strict";
// ─────────────────────────────────────────────────────────────────────
// Tojesus — 자료 폴더 tojesus/ 의 재등록 · 압축 넣기 (안드로이드 앱)
//
// 설계: docs/tojesus-자료폴더-설계.md
// 폴더를 다루는 손발은 안드로이드 부품(TojesusFolder), 구역·행선지 규칙은 DatasetImport,
// 여기는 둘을 이어 흐름을 이끌고 첫화면 설정에 카드를 그린다.
//
//   재등록 — 연결 확인 → 빠진 구역 폴더 만들기 → 훑기 → 구역마다
//            자료(bethlehem·egwbooks)는 앱 안으로(새것만) · 찬미가(sdahymnal)는 음원 폴더로 연결 ·
//            찬양(praise)은 새 곡을 세어 매일찬양에서 담게 · 오디오는 세어 둔다 · _inbox 의 압축은 풀지 묻는다
//   압축 넣기 — 목차만 읽어 행선지를 정해 보이고 → 안드로이드가 흘려 풀고 → 원본을 지울지 묻고 → 재등록
// ─────────────────────────────────────────────────────────────────────
const Tojesus = (() => {
  const plugin = () => {
    const C = window.Capacitor;
    return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.TojesusFolder) || null;
  };
  const tree = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.HymnTree) || null;
  const SUMMARY_KEY = "bible-tojesus-summary";
  const PRAISE_DONE_KEY = "bible-praise-tojesus-done";   // 매일찬양이 tojesus/praise 에서 담은 곡(경로)
  const CHUNK = 1024 * 1024;
  const D = () => DatasetImport;
  const isAudio = (p) => D().AUDIO_EXT.test(p);
  const leafOf = (p) => String(p).split("/").pop();

  const available = () => !!plugin();
  const status = async () => (plugin() ? plugin().status() : { linked: false });
  function summary() { try { return JSON.parse(localStorage.getItem(SUMMARY_KEY) || "null"); } catch (e) { return null; } }
  function praiseDone() { try { return new Set(JSON.parse(localStorage.getItem(PRAISE_DONE_KEY) || "[]")); } catch (e) { return new Set(); } }

  // 연결이 없거나 끊겼으면 한 번 고르게 한다
  async function ensureLinked() {
    let st = await status();
    if (st.linked && st.ok) return st;
    const msg = st.linked
      ? "tojesus 폴더에 닿지 않습니다(SD카드가 빠졌거나 권한이 거둬졌습니다).\n\n폴더를 다시 골라 주세요."
      : "자료 폴더 tojesus 를 한 번 골라 주세요.\n\n" +
        "· 휴대폰 저장공간이나 SD카드의 맨 위에서 「새 폴더 → tojesus」를 만들어 고르세요\n" +
        "· 이미 있으면 그 폴더를 고르시면 됩니다\n" +
        "· 그 위 폴더를 고르면 안에 tojesus 를 찾거나 만듭니다\n\n" +
        "한 번 고르면 다시 묻지 않습니다. 앱을 지워도 폴더는 남습니다.";
    if (!confirm(msg)) return null;
    const r = await plugin().pick();
    if (!r || !r.ok) return null;
    st = await status();
    return st.ok ? st : null;
  }

  // tojesus 안의 파일 하나를 조각으로 받아 File 로 — 자료를 앱 안으로 옮길 때
  async function readAsFile(rel, mtime) {
    const P = plugin();
    const o = await P.openRead({ rel });
    const parts = [];
    try {
      for (;;) {
        const r = await P.readNext({ handle: o.handle, length: CHUNK });
        if (r.data) {
          const raw = atob(r.data), u8 = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) u8[i] = raw.charCodeAt(i);
          parts.push(new Blob([u8]));
        }
        if (r.eof) break;
      }
    } catch (e) {
      P.closeRead({ handle: o.handle }).catch(() => {});
      throw e;
    }
    return new File(parts, leafOf(rel), { lastModified: mtime || 0 });
  }

  function marker() {
    const V = window.APP_VERSION || {};
    return JSON.stringify({
      tojesus: 1, by: "항상 예수께로 " + (V.name || ""), made: new Date().toISOString().slice(0, 10),
      areas: D().AREAS.map(a => ({ dir: a.key, what: a.label, how: a.note })),
      rule: "Gospel_Harmony/EGW/tojesus-데이터셋-설계.md 덧붙임 4"
    }, null, 2);
  }

  // ── 재등록 ─────────────────────────────────────────────────────────
  async function reregister(say) {
    say = say || (() => {});
    const st = await ensureLinked();
    if (!st) return null;
    const P = plugin();
    say("구역 폴더를 맞추는 중…");
    await P.ensureDirs({ names: D().AREA_KEYS, marker: marker() });
    say("tojesus 폴더를 훑는 중…");
    const sc = await P.scan();
    const by = {};
    D().AREA_KEYS.forEach(k => { by[k] = []; });
    const stray = [];
    for (const f of sc.files || []) {
      const seg = f.path.split("/");
      if (seg.length >= 2 && by[seg[0]]) by[seg[0]].push(f);
      else if (f.path !== "tojesus.json") stray.push(f.path);
    }
    const rep = { at: Date.now(), where: st.where, path: st.path, cut: !!sc.cut, stray,
      db: { added: 0, same: 0, failed: [] }, packs: 0, hymn: null, praise: {}, audio: {}, inbox: [], quota: false };

    // ① 자료 → 앱 안으로(새것만). 날짜로 먼저 견주어 같은 것은 읽지도 않는다
    const dbFiles = [...by.bethlehem, ...by.egwbooks].filter(f => D().DB_EXT.test(f.path));
    let i = 0;
    for (const f of dbFiles) {
      i++;
      const leaf = leafOf(f.path);
      if (await D().isUpToDate(leaf, f.mtime)) { rep.db.same++; continue; }
      say(`자료를 들이는 중… ${i}/${dbFiles.length} — ${leaf}`);
      try {
        const r = await D().storeDb(await readAsFile(f.path, f.mtime));
        if (r.ok) rep.db.added++;
        else if (r.older) rep.db.same++;
        else rep.db.failed.push(`${leaf} — ${r.error || "모르는 형식"}`);
      } catch (e) {
        const m = String((e && (e.name + " " + e.message)) || e);
        if (/quota|exceeded|space/i.test(m)) rep.quota = true;
        rep.db.failed.push(`${leaf} — ${(e && e.message) || e}`);
      }
    }
    // ② 찬미가 — 주소록은 앱 안으로, 음원은 폴더째 연결
    for (const f of by.sdahymnal.filter(x => /\.json$/i.test(x.path))) {
      try { const r = await D().addPack(await readAsFile(f.path, f.mtime)); if (r.ok) rep.packs++; } catch (e) { /* 주소록이 아닌 json */ }
    }
    const hymnAudio = by.sdahymnal.filter(x => isAudio(x.path));
    const T = tree();
    const had = T && T.saved ? await T.saved({}).catch(() => ({ ok: false })) : { ok: false };
    // 사람이 직접 고른 찬미가 폴더가 따로 있으면 묻고 바꾼다(SD카드의 7GB 폴더 등을 몰래 갈아치우지 않는다)
    const takeOver = hymnAudio.length && T && T.adopt && (!had.ok || had.tojesus ||
      confirm(`찬미가 음원 폴더를 tojesus/sdahymnal 로 바꿀까요?\n\n지금은 「${had.name || "고른 폴더"}」를 쓰고 있습니다.\n[취소]를 누르면 지금 폴더를 그대로 씁니다.`));
    if (!hymnAudio.length && had.ok && had.tojesus && had.uri !== st.tree && T.forget) {
      await T.forget({}).catch(() => {});   // 예전 tojesus 자리의 찬미가 칸 — 연결을 옮겼으니 놓는다
    }
    if (takeOver) {
      say("찬미가 음원 폴더를 연결하는 중…");
      try {
        await T.adopt({ slot: "hymn", uri: st.tree, root: st.root, sub: "sdahymnal" });
        if (typeof HymnFolder !== "undefined") {
          await HymnFolder.scan();
          rep.hymn = { mr: HymnFolder.count("mr"), song: HymnFolder.count("song"), files: hymnAudio.length };
        } else rep.hymn = { files: hymnAudio.length };
      } catch (e) { rep.hymn = { files: hymnAudio.length, error: (e && e.message) || String(e) }; }
    }
    // ③ 찬양 — 새 곡만 센다. 담기는 매일찬양의 담기 화면(분류·채널·태그 확인)에서
    const praiseAudio = by.praise.filter(x => isAudio(x.path));
    const done = praiseDone();
    rep.praise = {
      total: praiseAudio.length,
      albums: new Set(praiseAudio.map(x => x.path.split("/")[1])).size,
      fresh: praiseAudio.filter(x => !done.has(x.path.slice("praise/".length))).length
    };
    // ④ 오디오 — 지금은 세어 두기만(재생 화면은 다음 단계)
    for (const k of ["audiobible", "audioegw", "audiosermon"]) {
      const a = by[k].filter(x => isAudio(x.path));
      rep.audio[k] = { files: a.length, groups: [...new Set(a.map(x => x.path.split("/")[1]))].sort() };
    }
    // ⑤ 받은 압축
    rep.inbox = by._inbox.filter(x => /\.zip$/i.test(x.path)).map(x => ({ rel: x.path, name: leafOf(x.path), size: x.size }));
    rep.counts = Object.fromEntries(D().AREA_KEYS.map(k => [k, by[k].length]));
    try { localStorage.setItem(SUMMARY_KEY, JSON.stringify(rep)); } catch (e) { /* 요약은 다시 만들 수 있다 */ }
    return rep;
  }

  // ── 압축 넣기 ──────────────────────────────────────────────────────
  //   srcs: [{ uri, name, size }](고른 것) 또는 [{ rel, name, size }](_inbox 의 것)
  //   ui: { say, preview(info) → { askArea } | null, progress(ev) }
  async function importZips(srcs, ui) {
    const st = await ensureLinked();
    if (!st) return false;
    if (!st.writable) { alert("tojesus 폴더에 쓸 허락이 없습니다 — 「폴더 다시 고르기」로 한 번 더 골라 주세요."); return false; }
    const P = plugin();
    let any = false;
    for (const src of srcs) {
      const ref = src.uri ? { uri: src.uri } : { rel: src.rel };
      ui.say(`«${src.name}» 안을 살펴보는 중…`);
      let L;
      try { L = await P.zipList(ref); }
      catch (e) { alert(`«${src.name}» 을(를) 열지 못했습니다.\n\n${(e && e.message) || e}`); continue; }
      const base = String(src.name || "받은 음원").replace(/\.zip$/i, "");
      const placed = [], asks = [], skipped = { junk: 0, other: 0 };
      // 맥 파인더 압축은 모든 것이 폴더 하나(압축한 폴더 이름)에 싸여 있다 — 그 껍질은 떼고 본다.
      // 단, 그 껍질이 구역 이름이거나 tojesus 면 그대로 둔다(그 자체가 행선지다)
      const real = (L.entries || []).filter(e => !e.dir && !D().isJunk(D().fixName(e.name)));
      const tops = new Set(real.map(e => D().fixName(e.name).split("/")[0]));
      const shell = (tops.size === 1 && real.every(e => D().fixName(e.name).includes("/"))) ? [...tops][0] : "";
      const strip = shell && !D().AREA_KEYS.includes(shell.toLowerCase()) && shell.toLowerCase() !== "tojesus" ? shell + "/" : "";
      for (const e of L.entries || []) {
        if (e.dir) continue;
        const nm = D().fixName(e.name);
        const r = D().placeEntry(strip && nm.startsWith(strip) ? nm.slice(strip.length) : nm);
        if (r.skip) skipped[r.skip] = (skipped[r.skip] || 0) + 1;
        else if (r.ask) asks.push({ i: e.i, rel: r.rel, size: e.size });
        else placed.push({ i: e.i, dest: r.dest, area: r.area, size: e.size });
      }
      if (!placed.length && !asks.length) { alert(`«${src.name}» 에는 풀어 넣을 자료가 없습니다.`); continue; }
      const choice = await ui.preview({ name: src.name, size: src.size, placed, asks, skipped, base });
      if (!choice) continue;
      const items = placed.map(x => ({ i: x.i, dest: x.dest }))
        .concat(choice.askArea ? asks.map(a => ({ i: a.i, dest: D().destForAsk(choice.askArea, a.rel, base) })) : []);
      // 풀지 않고 남는 것 — 문서·그림 등과 「풀지 않음」으로 둔 음원(맥 찌꺼기는 빼고 센다)
      const leftOut = (skipped.other || 0) + (choice.askArea ? 0 : asks.length);
      const h = await P.addListener("zipProgress", ui.progress);
      let res;
      try { res = await P.zipExtract(Object.assign({ items }, ref)); }
      catch (e) { alert(`풀지 못했습니다.\n\n${(e && e.message) || e}`); continue; }
      finally { h.remove(); }
      if (res.wrote) any = true;   // 모두 이미 있던 것이면 다시 훑을 까닭이 없다
      ui.say(`✓ «${src.name}» — 새로 ${res.wrote}개` + (res.same ? ` · 이미 있던 ${res.same}개` : "") +
        (res.failed ? ` · 못 푼 ${res.failed}개` : "") + (res.cancelled ? " · 그만둠" : ""));
      if (res.cancelled) break;
      const mb = src.size > 0 ? ` (${Math.round(src.size / 1048576)}MB)` : "";
      const warns = [];
      if (res.failed) warns.push(`못 푼 파일 ${res.failed}개`);
      if (leftOut) warns.push(`풀지 않은 파일 ${leftOut}개(문서·그림이나 「풀지 않음」으로 둔 음원 — 원본에만 있습니다)`);
      const head = warns.length ? `«${src.name}» 을(를) 풀었습니다 — 다만 ${warns.join(", ")}.\n\n⚠ 원본을 지우면 그 파일은 사라집니다. 남겨 두기를 권합니다.`
        : `«${src.name}» 을(를) 다 풀었습니다.`;
      if (confirm(`${head}\n\n원본 압축파일${mb}을 지울까요?\n\n[취소]를 누르면 그대로 둡니다.`)) {
        try { await P.deleteDoc(ref); }
        catch (e) { alert(`원본을 지우지 못했습니다 — 파일 관리자에서 지워 주세요.\n\n${(e && e.message) || e}`); }
      }
    }
    return any;
  }

  return { available, status, ensureLinked, reregister, importZips, summary, praiseDone,
           pickZip: () => plugin().pickZip(), cancel: () => plugin() && plugin().cancelExtract(),
           relink: () => plugin().pick(), PRAISE_DONE_KEY };
})();

// ─────────────────────────────────────────────────────────────────────
// 첫화면 ⚙ 설정 › 파일관리 의 카드
// ─────────────────────────────────────────────────────────────────────
const TojesusUI = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mb = (n) => (n > 0 ? (n >= 1073741824 ? (n / 1073741824).toFixed(1) + "GB" : Math.max(1, Math.round(n / 1048576)) + "MB") : "");
  let busy = false;

  function say(m) { const el = $("tj-status"); if (el) el.textContent = m; }

  function progress(ev) {
    const bar = $("tj-bar"), fill = $("tj-bar-fill");
    if (!bar) return;
    bar.hidden = false;
    const pct = ev.totalBytes > 0 ? Math.min(100, Math.round(ev.bytes / ev.totalBytes * 100)) : Math.round(ev.done / Math.max(1, ev.total) * 100);
    fill.style.transform = `scaleX(${pct / 100})`;
    say(`푸는 중… ${ev.done + 1}/${ev.total} (${pct}%) — ${ev.name}`);
  }

  function renderAreas() {
    const s = Tojesus.summary();
    const box = $("tj-areas");
    if (!box) return;
    const row = (a, num, extra) => `<div class="tj-area"><span class="tj-ico">${a.ico}</span>
      <span class="tj-name">${esc(a.label)}<small>${esc(a.key)}/</small></span>
      <span class="tj-num">${num}</span>${extra ? `<div class="tj-extra">${extra}</div>` : ""}</div>`;
    box.innerHTML = DatasetImport.AREAS.filter(a => a.key !== "_inbox").map(a => {
      if (!s) return row(a, "—");
      const c = (s.counts || {})[a.key] || 0;
      if (a.key === "sdahymnal" && s.hymn) return row(a, s.hymn.files || c, s.hymn.mr != null ? `반주 ${s.hymn.mr}곡 · 찬양 ${s.hymn.song}곡 — 찬미가 음원 폴더로 연결됨` : "");
      if (a.key === "praise") {
        const p = s.praise || {};
        return row(a, p.total || 0, p.fresh ? `새 곡 ${p.fresh} · <a href="praise.html?collect=tojesus">🎵 매일찬양에서 담기</a>` : p.total ? `앨범 ${p.albums} — 모두 담겨 있습니다` : "");
      }
      if (s.audio && s.audio[a.key]) {
        const au = s.audio[a.key];
        const tabOf = { audiobible: "bible", audioegw: "egw", audiosermon: "sermon" }[a.key];
        return row(a, au.files, au.files ? esc(au.groups.slice(0, 6).join(" · ")) + (au.groups.length > 6 ? " …" : "") +
          ` · <a href="listen.html?tab=${tabOf}">👂 말씀듣기</a>` : "");
      }
      return row(a, c);
    }).join("");
  }

  async function renderStatus() {
    const st = await Tojesus.status();
    const s = Tojesus.summary();
    const el = $("tj-where");
    if (!el) return;
    if (!st.linked) el.innerHTML = "아직 연결하지 않았습니다 — <b>재등록</b>을 누르면 폴더를 한 번 고릅니다.";
    else if (!st.ok) el.innerHTML = "⚠ <b>tojesus 폴더에 닿지 않습니다</b> — SD카드가 빠졌거나 권한이 거둬졌습니다. 재등록을 눌러 다시 고르세요.";
    else el.innerHTML = `연결: <b>${esc(st.where)} › ${esc(st.path)}</b>` +
      (s ? ` · 마지막 재등록 ${new Date(s.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}` : "") +
      (st.writable ? "" : " · ⚠ 쓰기 허락 없음");
    $("tj-relink").hidden = !st.linked;
  }

  function reportText(r) {
    const bits = [];
    bits.push(`자료 ${r.db.added ? `새로 ${r.db.added}` : "새것 없음"}${r.db.same ? ` · 이미 최신 ${r.db.same}` : ""}`);
    if (r.packs) bits.push(`주소록 ${r.packs}`);
    if (r.hymn && r.hymn.mr != null) bits.push(`찬미가 반주 ${r.hymn.mr} · 찬양 ${r.hymn.song}`);
    if (r.praise.fresh) bits.push(`찬양 새 곡 ${r.praise.fresh}`);
    let t = "✓ " + bits.join(" · ");
    if (r.db.failed.length) t += ` · ⚠ 못 들인 자료 ${r.db.failed.length}`;
    if (r.quota) t += " — 저장 공간이 모자랍니다";
    return t;
  }

  async function doReregister(opt) {
    const afterZips = !!(opt && opt.afterZips);   // 압축을 막 풀고 이어 부른 것 — 남겨 둔 받은 압축을 또 묻지 않는다
    if (busy) return;
    busy = true;
    try {
      const r = await Tojesus.reregister(say);
      if (!r) { say("그만두었습니다"); return; }
      say(reportText(r));
      renderAreas();
      const notes = [];
      if (r.db.failed.length) notes.push("들이지 못한 자료:\n" + r.db.failed.slice(0, 8).map(x => "· " + x).join("\n"));
      if (r.stray.length) notes.push(`구역 폴더 밖에 있는 파일 ${r.stray.length}개 — 읽지 않았습니다:\n` + r.stray.slice(0, 5).map(x => "· " + x).join("\n"));
      if (r.cut) notes.push("파일이 너무 많아 앞부분만 훑었습니다.");
      if (notes.length) alert(notes.join("\n\n"));
      if (r.inbox.length && !afterZips && confirm(`받은 압축(_inbox)이 ${r.inbox.length}개 있습니다:\n\n` +
          r.inbox.map(z => `· ${z.name} ${mb(z.size)}`).join("\n") + "\n\n지금 풀어 넣을까요?")) {
        busy = false;
        await doZips(r.inbox);
        return;
      }
      if (r.praise.fresh && confirm(`찬양 앨범에 새 곡이 ${r.praise.fresh}곡 있습니다.\n\n매일찬양에서 분류·채널을 확인하고 담을까요?`)) {
        location.href = "praise.html?collect=tojesus";
      }
    } catch (e) {
      say("재등록하지 못했습니다: " + ((e && e.message) || e));
    } finally { busy = false; renderStatus(); }
  }

  async function doZips(srcs) {
    if (busy) return;
    busy = true;
    $("tj-cancel").hidden = false;
    try {
      const any = await Tojesus.importZips(srcs, { say, preview, progress });
      $("tj-bar").hidden = true;
      if (any) { busy = false; await doReregister({ afterZips: true }); }
    } catch (e) {
      say("풀지 못했습니다: " + ((e && e.message) || e));
    } finally { busy = false; $("tj-cancel").hidden = true; $("tj-bar").hidden = true; }
  }

  async function pickAndImport() {
    if (busy) return;
    let r;
    try { r = await Tojesus.pickZip(); } catch (e) { say("압축파일을 고르지 못했습니다: " + ((e && e.message) || e)); return; }
    if (r && r.ok && r.files.length) await doZips(r.files);
  }

  // ── 미리보기 — 어디에 풀지 보여 주고, 모르는 음원의 자리를 고르게 한다 ──
  function preview(info) {
    return new Promise((resolve) => {
      const groups = {};
      for (const x of info.placed) {
        const g = groups[x.area] || (groups[x.area] = { n: 0, bytes: 0 });
        g.n++; g.bytes += Math.max(0, x.size || 0);
      }
      const askBytes = info.asks.reduce((a, x) => a + Math.max(0, x.size || 0), 0);
      const A = DatasetImport.AREAS;
      const rows = A.filter(a => groups[a.key]).map(a => `<div class="tj-area"><span class="tj-ico">${a.ico}</span>
        <span class="tj-name">${esc(a.label)}<small>${esc(a.key)}/</small></span>
        <span class="tj-num">${groups[a.key].n}<small>${mb(groups[a.key].bytes)}</small></span></div>`).join("");
      const opts = [["praise", "🎵 찬양 앨범 — praise/"], ["audiosermon", "📻 설교·오디오북 — audiosermon/"],
        ["audiobible", "🎧 성경 오디오 — audiobible/"],
        ...DatasetImport.EGW_LANGS.map(l => [`audioegw/${l}`, `🎙 예언의신 오디오 — audioegw/${l}/`]),
        ["sdahymnal", "🎹 찬미가 — sdahymnal/"], ["", "풀지 않음"]];
      const ask = info.asks.length ? `<div class="tj-ask">
          <b>어디에 둘지 모르는 음원 ${info.asks.length}개</b> ${mb(askBytes)}
          <div class="tj-asklist">${info.asks.slice(0, 4).map(a => esc(a.rel)).join("<br>")}${info.asks.length > 4 ? "<br>…" : ""}</div>
          <select id="tj-ask-area">${opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("")}</select>
          <div class="tj-hint">폴더 없이 들어 있던 곡은 「${esc(info.base)}」 칸으로 묶습니다</div></div>` : "";
      const skipN = (info.skipped.other || 0) + (info.skipped.junk || 0);
      const ov = document.createElement("div");
      ov.className = "tj-sheet";
      ov.innerHTML = `<div class="box">
        <h3>🗜 ${esc(info.name)} ${mb(info.size)}</h3>
        <div class="desc">tojesus 폴더에 이렇게 풀어 넣습니다. 같은 크기의 파일이 이미 있으면 건너뜁니다.</div>
        ${rows}${ask}
        ${skipN ? `<div class="tj-hint">그 밖의 파일 ${skipN}개(맥 찌꺼기·문서 등)는 풀지 않습니다</div>` : ""}
        <div class="acts"><button class="b-ghost" data-x="no">취소</button><button class="b-gold" data-x="ok">풀기</button></div>
      </div>`;
      document.body.appendChild(ov);
      const close = (v) => { ov.remove(); resolve(v); };
      ov.addEventListener("click", (e) => {
        if (e.target === ov) return close(null);
        const x = e.target.dataset && e.target.dataset.x;
        if (x === "no") close(null);
        if (x === "ok") { const sel = ov.querySelector("#tj-ask-area"); close({ askArea: sel ? sel.value : "" }); }
      });
    });
  }

  function mount() {
    const host = $("tojesus-card");
    if (!host || !Tojesus.available()) return false;
    host.hidden = false;
    host.innerHTML = `
      <div class="hset-sub">📂 tojesus 자료 폴더</div>
      <div class="desc">성경·예언의신·찬미가·찬양·설교 자료를 <b>tojesus 폴더 하나</b>에 모아 둡니다.
        내장 저장소나 SD카드 맨 위에 두세요. 앱을 지워도 폴더는 남습니다.</div>
      <div class="desc" id="tj-where"></div>
      <div class="acts" style="margin-top:6px">
        <button class="b-gold" id="tj-rereg">🔄 재등록</button>
        <button class="b-ghost" id="tj-zip">🗜 압축파일 넣기</button>
      </div>
      <div class="tj-bar" id="tj-bar" hidden><i id="tj-bar-fill"></i></div>
      <div class="desc" id="tj-status" style="margin:8px 0 0"></div>
      <button class="tj-link" id="tj-cancel" hidden>■ 그만두기</button>
      <div id="tj-areas" class="tj-areas"></div>
      <div class="tj-links">
        <button class="tj-link" id="tj-relink" hidden>폴더 다시 고르기</button>
        <button class="tj-link" id="tj-guide-btn">폴더 배치 안내</button>
      </div>
      <pre class="tj-guide" id="tj-guide" hidden>tojesus/
${DatasetImport.AREAS.map(a => `├─ ${(a.key + "/").padEnd(13)} ${a.label} — ${a.note}`).join("\n")}</pre>`;
    $("tj-rereg").addEventListener("click", () => doReregister());
    $("tj-zip").addEventListener("click", pickAndImport);
    $("tj-cancel").addEventListener("click", () => { Tojesus.cancel(); say("그만두는 중…"); });
    $("tj-relink").addEventListener("click", async () => {
      if (busy) return;
      try { const r = await Tojesus.relink(); if (r && r.ok) { await renderStatus(); doReregister(); } }
      catch (e) { say((e && e.message) || String(e)); }
    });
    $("tj-guide-btn").addEventListener("click", () => { $("tj-guide").hidden = !$("tj-guide").hidden; });
    renderStatus();
    renderAreas();
    return true;
  }

  return { mount, renderStatus };
})();
