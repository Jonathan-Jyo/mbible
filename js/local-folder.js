// ============================================================================
// LocalFolder — 구글드라이브가 없을 때의 대안: 내 기기 폴더로 첨부 모으기
// ----------------------------------------------------------------------------
// · APK(Capacitor): tojesus/attach 에 기록(v5.33.0) — 앱 자료를 tojesus 한 곳에 모은다.
//   예전 자리 문서(Documents)/항상예수께로 에 남은 파일은 처음 복사할 때(또는 🔄 재등록 때) 옮겨 온다.
//   tojesus 가 연결되어 있지 않으면 먼저 연결하라고 알린다(옛 자리에 새로 쓰지 않는다)
// · PC 브라우저(크롬·엣지): 폴더 선택 창에서 고른 폴더로 복사 (tojesus 폴더 안 attach 를 권한다 ·
//   선택한 폴더는 기기에 기억됨)
// · 복사된 첨부에는 localAt 표식 — 다음 복사 때 새 것만 담는다
// ============================================================================

const LocalFolder = (() => {
  const FOLDER = "tojesus/attach";        // 화면에 보일 자리 이름(앱)
  const AREA = "attach";
  const CHUNK = 512 * 1024;
  const DB = "bible-localdir", STORE = "handles";

  const isCap = () => !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins && Capacitor.Plugins.TojesusFolder);
  const tf = () => Capacitor.Plugins.TojesusFolder;
  const canPick = () => typeof window.showDirectoryPicker === "function";
  const isSupported = () => isCap() || canPick();

  // ── 브라우저: 선택한 폴더 핸들을 IndexedDB에 기억 ────────────────────
  function _hdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function _htx(mode, fn) {
    return _hdb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && typeof out === "object" && "result" in out ? out.result : out);   // 조회 미스는 undefined로 (요청 객체가 새어 나가 truthy 오판되던 버그 수정)
      tx.onerror = () => reject(tx.error);
    }));
  }

  async function _pickDir(forceNew) {
    let handle = forceNew ? null : await _htx("readonly", os => os.get("dir")).catch(() => null);
    if (handle) {
      const perm = await handle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted" && (await handle.requestPermission({ mode: "readwrite" })) !== "granted") handle = null;
    }
    if (!handle) {
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
      await _htx("readwrite", os => os.put(handle, "dir"));
    }
    return handle;
  }

  const _fileName = (a) => `${a.id}_${(a.name || "첨부").replace(/[\\/:*?"<>|]/g, "_")}`;

  async function _writeWeb(dir, att) {
    const fh = await dir.getFileHandle(_fileName(att), { create: true });
    const w = await fh.createWritable();
    await w.write(att.blob);
    await w.close();
  }

  const _b64 = (blob) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
  // 앱 — tojesus/attach 에 조각으로 쓴다. 임시 이름에 쓰고 다 쓴 뒤 진짜 이름이 된다(TojesusFolder.praiseWrite*)
  async function _writeCap(att) {
    const T = tf(), blob = att.blob;
    const b = await T.praiseWriteBegin({ area: AREA, dest: _fileName(att), size: blob.size });
    if (b.same) return;                                  // 같은 이름·크기가 이미 있다
    try {
      for (let off = 0; off < blob.size; off += CHUNK) await T.praiseWriteChunk({ handle: b.handle, data: await _b64(blob.slice(off, off + CHUNK)) });
      await T.praiseWriteEnd({ handle: b.handle });
    } catch (e) {
      T.praiseWriteAbort({ handle: b.handle }).catch(() => {});
      throw e;
    }
  }

  // 옛 자리(문서/항상예수께로)에 남은 첨부를 tojesus/attach 로 옮긴다 — { moved, same, failed, total, left } · 옮길 것 없으면 null
  async function migrate() {
    if (!isCap() || !tf().attachMigrate) return null;
    const r = await tf().attachMigrate();
    if (!r || r.none) return null;
    return r;
  }

  // ── 아직 복사 안 된 첨부 전부를 폴더로 ───────────────────────────────
  //  반환: { total, ok, fail, dest }  (dest: 사용자 안내용 위치 문구)
  async function copyAll(onProgress, forceNewDir) {
    if (!isSupported()) throw new Error("이 브라우저는 폴더 저장을 지원하지 않습니다 — 백업 zip의 첨부 포함 옵션을 이용해 주세요");
    const all = await AttachStore.listAll();
    const todo = all.filter(a => !a.localAt);
    let dir = null, dest, moved = null;
    if (isCap()) {
      const st = await tf().status().catch(() => null);
      if (!st || !st.linked || !st.ok) throw new Error("tojesus 폴더가 연결되어 있지 않습니다 — 첫화면 ⚙ 설정 › 파일관리 › 🔄 재등록으로 먼저 연결해 주세요");
      if (!st.writable) throw new Error("이 tojesus 폴더에는 앱이 바로 쓸 수 없습니다 — ⚙ 파일관리 › 「다른 폴더 고르기」로 tojesus 를 한 번 골라 주세요");
      dest = `${st.where} › ${FOLDER}`;
      try { moved = await migrate(); } catch (e) { console.warn("[첨부] 옛 첨부 폴더를 옮기지 못했습니다", e); }
    }
    else { dir = await _pickDir(forceNewDir); dest = `선택한 폴더 (${dir.name})`; }
    let ok = 0, fail = 0;
    for (const att of todo) {
      try {
        if (isCap()) await _writeCap(att); else await _writeWeb(dir, att);
        await AttachStore.update(att.id, { localAt: Date.now() });
        ok++;
      } catch (e) { fail++; }
      if (onProgress) onProgress(ok + fail, todo.length);
    }
    return { total: todo.length, ok, fail, dest, moved };
  }

  return { FOLDER, isSupported, isCap, canPick, copyAll, migrate };
})();
