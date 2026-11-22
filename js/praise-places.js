// ============================================================================
// PraisePlaces — 매일찬양 ⚙ 「📍 위치 등록」 · 「📦 모으기」 (v5.30.0, 설계 14항)
// ----------------------------------------------------------------------------
// 위치 등록: 사용자 음악 폴더를 골라 곡을 **복사하지 않고 자리만** 등록한다 — src { at:"link", loc, path }.
//   소리는 안드로이드가 그 자리에서 흘려 준다(/_praiselink_/…, PraiseLink.java). 위치 목록은 안드로이드가 기억한다.
// 모으기: 등록 위치의 곡·앱 안 곡을 tojesus/praise/<앨범>/ 으로 — 복사 / 이동을 그때 고른다.
//   다 옮긴 곡은 src { at:"tj", path } 가 된다. 앱 안 곡은 늘 복사한 뒤 앱 안 사본을 지울지 묻는다.
//
//   PraisePlaces.mount(hooks)   praise-app.js 가 부른다 — { toast, render, syncAlarms, importFiles, srcSong, markDone, showCollect }
//   PraisePlaces.nameOf(loc)    등록 위치 이름(마지막으로 본 것) — 상세 창 한 줄
//   PraisePlaces.relocate(loc)  「위치 다시 찾기」 → 다시 이어진 곡이 있으면 true
// ============================================================================
const PraisePlaces = (() => {
  const $ = (s) => document.querySelector(s);
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const K_NAMES = "bible-praise-link-names";   // { L1: "시험" } — 상세 창이 곧바로 이름을 쓰게
  const CHUNK = 512 * 1024;                     // 앱 안 곡을 tojesus 로 써낼 때 한 번에 넘기는 크기
  const APP_ALBUM = "앱에서 모은 찬양";
  let H = null;

  const cap = (name) => {
    const C = window.Capacitor;
    const native = C && typeof C.isNativePlatform === "function" && C.isNativePlatform();
    return native && C.Plugins ? C.Plugins[name] || null : null;
  };
  const link = () => cap("PraiseLink");
  const tf = () => cap("TojesusFolder");

  function names() { try { return JSON.parse(localStorage.getItem(K_NAMES) || "{}") || {}; } catch (e) { return {}; } }
  function nameOf(loc) { return names()[loc] || loc || "등록 위치"; }
  function saveNames(list) {
    const n = {};
    list.forEach(x => { n[x.id] = x.name; });
    try { localStorage.setItem(K_NAMES, JSON.stringify(n)); } catch (e) { console.warn("[위치 등록] 이름을 저장하지 못했습니다", e); }
  }
  const songsAt = (loc) => PraiseStore.items().filter(it => { const s = PraiseStore.srcOf(it); return s.at === "link" && s.loc === loc; });

  // ── 설정 화면에 붙이기 ──────────────────────────────────────────────
  async function mount(hooks) {
    H = hooks;
    if (!link()) { H.showCollect(true); return; }        // 브라우저 — 지금처럼 폴더·파일 고르기
    $("#set-link-box").hidden = false;
    $("#set-link-btn").addEventListener("click", () => register().catch(fail("위치를 등록하지 못했습니다")));
    $("#set-gather-btn").addEventListener("click", () => openGather().catch(fail("모으기를 열지 못했습니다")));
    $("#gather-cancel").addEventListener("click", () => $("#gather-overlay").classList.remove("show"));
    $("#gather-go").addEventListener("click", () => runGather().catch(fail("모으기를 마치지 못했습니다")));
    // 🎵 음악 모으기(앱 안 복사)는 tojesus 연결이 없을 때만 — 있으면 tojesus/praise 에 두고 재등록
    let st = null;
    try { st = await tf().status(); } catch (e) { console.warn("[위치 등록] tojesus 상태를 읽지 못했습니다", e); }
    const linked = !!(st && st.linked && st.ok);
    H.showCollect(!linked);
    const why = $("#set-collect-why");
    if (why && !linked) why.innerHTML = "<br><b>tojesus 폴더가 연결되어 있지 않아</b> 곡을 앱 안에 복사합니다. 연결하면 tojesus/praise 에 두고 그 자리에서 틉니다.";
    renderLocations();
  }
  const fail = (what) => (e) => {
    console.warn("[위치 등록]", what, e);
    alert(`${what}.\n\n${(e && e.message) || e}`);
  };

  // ── 등록 위치 목록 ──────────────────────────────────────────────────
  async function renderLocations() {
    const box = $("#set-link-list");
    if (!box || !link()) return;
    let list = [];
    try { list = ((await link().locations()) || {}).list || []; }
    catch (e) { box.textContent = "등록 위치를 읽지 못했습니다"; return; }
    saveNames(list);
    box.innerHTML = list.map(x => {
      const n = songsAt(x.id).length;
      const how = !x.ok ? "🚫 닿지 않음 — 다시 골라 주세요" : x.way === "file" ? "파일 길" : "고른 폴더";
      return `<div class="link-row${x.ok ? "" : " off"}"><span class="ln">📍 ${esc(x.name)}<small>${n}곡 · ${how}</small></span>
        <button class="mini-x" data-more="${esc(x.id)}">${x.ok ? "새 곡 읽기" : "다시 찾기"}</button>
        <button class="mini-x" data-forget="${esc(x.id)}">지우기</button></div>`;
    }).join("");
    box.querySelectorAll("[data-more]").forEach(b => b.addEventListener("click", () => {
      const x = list.find(v => v.id === b.dataset.more);
      (x && x.ok ? readLocation(x.id, true) : relocate(b.dataset.more)).catch(fail("위치를 읽지 못했습니다"));
    }));
    box.querySelectorAll("[data-forget]").forEach(b => b.addEventListener("click", () => forget(b.dataset.forget).catch(fail("위치를 지우지 못했습니다"))));
  }

  // ── 위치 등록 ──────────────────────────────────────────────────────
  async function register() {
    if (!confirm("📍 위치 등록\n\n고른 폴더의 곡을 복사하지 않습니다 — 자리만 등록해 그 폴더에서 바로 틉니다.\n\n" +
      "· 그 폴더의 곡을 지우거나 옮기면 매일찬양에서도 들을 수 없게 됩니다(🚫).\n" +
      "· 오래 두실 곡이면 나중에 「📦 모으기」로 tojesus/praise 에 들여오세요.\n\n폴더를 고를까요?")) return;
    const r = await link().pick({});
    if (!r || !r.ok) return;
    if (r.local === false &&
        !confirm("구글 드라이브 같은 구름 폴더입니다.\n\n인터넷이 없으면 재생되지 않고, 목록을 다 못 읽을 수 있습니다. 기기 안 폴더를 권합니다.\n\n그래도 등록할까요?")) {
      await link().forget({ id: r.id }).catch(() => {});
      return;
    }
    await readLocation(r.id, false);
    renderLocations();
  }

  /** 그 위치의 곡을 담기 화면으로 — onlyNew: 이미 등록한 경로는 빼고 */
  async function readLocation(loc, onlyNew) {
    H.toast("폴더를 읽는 중…");
    const res = await link().list({ id: loc });
    let files = (res.files || []).slice().sort();
    if (res.cut) alert("폴더가 너무 커서 앞부분만 읽었습니다.");
    if (onlyNew) {
      const have = new Set(songsAt(loc).map(it => PraiseStore.srcOf(it).path));
      files = files.filter(rel => !have.has(rel));
    }
    if (!files.length) { H.toast(onlyNew ? "새로 읽을 곡이 없습니다 ✓" : "이 폴더에서 음원을 찾지 못했습니다"); return; }
    H.importFiles(files.map(rel => H.srcSong(rel, { at: "link", loc, path: rel })));
  }

  async function forget(loc) {
    const songs = songsAt(loc);
    if (!confirm(`등록 위치 「${nameOf(loc)}」를 지울까요?` +
      (songs.length ? `\n\n이 위치의 ${songs.length}곡도 매일찬양 목록에서 빠집니다.` : "") +
      "\n\n폴더와 그 안의 원본 파일은 지우지 않습니다.")) return;
    for (const it of songs) await PraiseStore.remove(it.id);
    await link().forget({ id: loc });
    H.render();
    await H.syncAlarms();
    renderLocations();
    H.toast("등록 위치를 지웠습니다 — 원본 파일은 그대로 있습니다");
  }

  /** 🚫 「위치 다시 찾기」 — 같은 번호에 새로 고른 폴더를 잇는다. 곡들의 폴더 안 경로는 그대로 쓴다 */
  async function relocate(loc) {
    if (!link()) return false;
    if (!confirm(`「${nameOf(loc)}」의 곡을 찾지 못했습니다.\n\n폴더를 옮기셨다면 옮긴 그 폴더를 골라 주세요 — 안의 곡 이름·하위 폴더가 같으면 다시 이어집니다.`)) return false;
    const r = await link().pick({ relocate: loc });
    if (!r || !r.ok) return false;
    const c = await PraiseSrc.check();
    const left = songsAt(loc).filter(it => !it.hasAudio).length;
    H.render();
    renderLocations();
    alert(left ? `${(c && c.back) || 0}곡이 다시 이어졌습니다. ${left}곡은 그 폴더에서도 찾지 못했습니다.` : `「${r.name}」로 다시 이었습니다 ✓`);
    await H.syncAlarms();
    return true;
  }

  // ── 모으기 ─────────────────────────────────────────────────────────
  let _groups = null;
  const safeName = (t) => String(t || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim().slice(0, 80);

  async function openGather() {
    const st = await tf().status().catch(() => null);
    if (!st || !st.linked || !st.ok) {
      alert("tojesus 폴더가 연결되어 있지 않습니다.\n\n첫화면 ⚙ 설정 › 파일관리 › 🔄 재등록에서 먼저 연결해 주세요.");
      return;
    }
    if (!st.writable) {
      alert("이 tojesus 폴더에는 앱이 바로 쓸 수 없습니다(안드로이드 10 이하의 SD카드 등).\n\n" +
        "첫화면 ⚙ 파일관리 › 「다른 폴더 고르기」로 그 tojesus 를 한 번 골라 주세요 — 고른 폴더에는 쓸 수 있습니다.");
      return;
    }
    let locs = [];
    try { locs = ((await link().locations()) || {}).list || []; } catch (e) { console.warn("[모으기] 등록 위치를 읽지 못했습니다", e); }
    saveNames(locs);
    const groups = [];
    for (const x of locs) {
      const songs = songsAt(x.id).filter(it => it.hasAudio);
      if (songs.length) groups.push({ kind: "link", loc: x.id, name: x.name, deletable: !!x.deletable, songs, album: safeName(x.name) || "모은 찬양", on: true });
    }
    const app = PraiseStore.items().filter(it => it.hasAudio && PraiseStore.srcOf(it).at === "app");
    if (app.length) groups.push({ kind: "app", name: "앱 안에 담긴 곡", songs: app, album: APP_ALBUM, on: !groups.length });
    if (!groups.length) { H.toast("모을 곡이 없습니다 — 등록 위치나 앱 안에 담긴 곡이 없습니다"); return; }
    _groups = groups;
    $("#gather-summary").innerHTML = `<b>${esc(st.where)} › tojesus/praise/</b> 아래 앨범 폴더로 들여옵니다. 들여온 곡은 그 자리에서 틉니다.<br>` +
      "같은 이름의 파일이 이미 있으면 크기가 같을 때 그것을 쓰고, 다르면 「이름 (2)」로 따로 둡니다.";
    $("#gather-groups").innerHTML = groups.map((g, i) => `
      <div class="gather-group">
        <input type="checkbox" data-gon="${i}"${g.on ? " checked" : ""} aria-label="${esc(g.name)} 모으기">
        <div class="gg"><b>${g.kind === "link" ? "📍" : "📱"} ${esc(g.name)}</b> · ${g.songs.length}곡
          <small>${g.kind === "app" ? "앱 안 사본을 폴더로 써냅니다" : g.deletable ? "이동하면 이 폴더의 원본을 지웁니다" : "이 폴더는 원본을 지울 권한이 없어 이동을 골라도 복사만 됩니다"}</small>
          <input class="imp-tags gg-album" data-galbum="${i}" value="${esc(g.album)}" placeholder="앨범 폴더 이름" aria-label="앨범 폴더 이름"></div>
      </div>`).join("");
    $("#gather-groups").querySelectorAll("[data-gon]").forEach(el => el.addEventListener("change", () => { _groups[+el.dataset.gon].on = el.checked; }));
    $("#gather-groups").querySelectorAll("[data-galbum]").forEach(el => el.addEventListener("input", () => { _groups[+el.dataset.galbum].album = el.value; }));
    $("#gather-overlay").classList.add("show");
  }

  const blobBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const extOf = (mime) => /mp4|m4a|aac/.test(mime) ? ".m4a" : /ogg|opus/.test(mime) ? ".ogg" : /wav/.test(mime) ? ".wav" : /webm/.test(mime) ? ".webm" : /flac/.test(mime) ? ".flac" : ".mp3";

  // 앱 안 곡 하나를 tojesus/praise 로 써낸다 → praise 기준 경로
  async function writeAppSong(it, album) {
    const blob = await PraiseSrc.blob(it.id);
    if (!blob || !blob.size) throw new Error("앱 안 음원이 없습니다");
    const dest = `${album}/${safeName(it.title) || it.id}${extOf(blob.type || "")}`;
    const T = tf();
    const b = await T.praiseWriteBegin({ dest, size: blob.size });
    if (b.same) return b.path;
    try {
      for (let off = 0; off < blob.size; off += CHUNK) {
        await T.praiseWriteChunk({ handle: b.handle, data: await blobBase64(blob.slice(off, off + CHUNK)) });
      }
      return (await T.praiseWriteEnd({ handle: b.handle })).path;
    } catch (e) {
      T.praiseWriteAbort({ handle: b.handle }).catch(() => {});
      throw e;
    }
  }

  let _gathering = false;
  async function runGather() {
    if (!_groups || _gathering) return;   // 두 번 눌러 같은 이름을 동시에 쓰지 않게
    _gathering = true;
    try { await gatherNow(); } finally { _gathering = false; }
  }
  async function gatherNow() {
    const picked = _groups.filter(g => g.on);
    if (!picked.length) { H.toast("모을 묶음을 하나 이상 골라 주세요"); return; }
    for (const g of picked) {
      g.album = safeName(g.album);
      if (!g.album) { alert(`「${g.name}」의 앨범 폴더 이름을 적어 주세요.`); return; }
    }
    const move = (document.querySelector('input[name="gather-how"]:checked') || {}).value === "move";
    const total = picked.reduce((a, g) => a + g.songs.length, 0);
    const linkMove = move ? picked.filter(g => g.kind === "link" && g.deletable).reduce((a, g) => a + g.songs.length, 0) : 0;
    if (move && linkMove &&
        !confirm(`이동을 고르셨습니다.\n\n다 옮긴 뒤 등록 위치의 원본 ${linkMove}곡을 지웁니다. 지운 원본은 되돌릴 수 없습니다 — 새 자리(tojesus/praise)에 다 쓴 것을 확인한 곡만 지웁니다.\n\n이동할까요?`)) return;
    $("#gather-overlay").classList.remove("show");
    let done = 0, moved = 0, same = 0;
    const failed = [], appDone = [];
    for (const g of picked) {
      for (const it of g.songs) {
        done++;
        H.toast(`모으는 중… ${done}/${total} — ${it.title}`);
        try {
          let path;
          if (g.kind === "link") {
            const s = PraiseStore.srcOf(it);
            const r = await tf().praiseCopy({ from: { loc: s.loc, path: s.path }, dest: `${g.album}/${s.path}`, move: move && g.deletable });
            path = r.path;
            if (r.moved) moved++;
            if (r.same) same++;
          } else {
            path = await writeAppSong(it, g.album);
            appDone.push(it.id);
          }
          PraiseStore.update(it.id, { src: { at: "tj", path }, hasAudio: true });
          H.markDone(path);   // 재등록이 「새 곡」으로 다시 세지 않게
        } catch (e) {
          failed.push(`${it.title} — ${(e && e.message) || e}`);
        }
      }
    }
    _groups = null;
    H.render();
    await H.syncAlarms();
    renderLocations();
    const ok = total - failed.length;
    const LIST_MAX = 6;
    alert(`📦 ${ok}곡을 tojesus/praise 로 ${move ? "옮겼습니다" : "복사했습니다"}.` +
      (moved ? `\n원본을 지운 곡 ${moved}` : "") + (same ? `\n이미 같은 파일이 있어 그것을 쓴 곡 ${same}` : "") +
      (failed.length ? `\n\n옮기지 못한 곡 ${failed.length}:\n` + failed.slice(0, LIST_MAX).map(x => "· " + x).join("\n") +
        (failed.length > LIST_MAX ? `\n… 외 ${failed.length - LIST_MAX}곡` : "") : ""));
    if (appDone.length && confirm(`앱 안에 담겨 있던 ${appDone.length}곡을 tojesus/praise 로 써냈습니다.\n\n이제 그 폴더에서 틉니다. 앱 안 사본을 지워 자리를 비울까요?\n([취소]를 누르면 앱 안 사본을 그대로 둡니다)`)) {
      let gone = 0;
      for (const id of appDone) {
        try { await PraiseAudio.remove(id); gone++; } catch (e) { console.warn("[모으기] 앱 안 사본을 지우지 못했습니다", id, e); }
      }
      H.toast(`앱 안 사본 ${gone}곡을 지웠습니다`);
    }
  }

  return { mount, nameOf, relocate };
})();
