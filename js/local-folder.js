// ============================================================================
// LocalFolder — 구글드라이브가 없을 때의 대안: 내 기기 '항상예수께로' 폴더로 첨부 모으기
// ----------------------------------------------------------------------------
// · APK(Capacitor): 문서(Documents)/항상예수께로 폴더에 바로 기록 — 안드로이드에는
//   바탕화면이 없으므로 파일앱에서 보이는 문서 폴더가 그 자리를 대신한다
// · PC 브라우저(크롬·엣지): 폴더 선택 창에서 바탕화면에 '항상예수께로' 폴더를
//   만들어 지정 → 이후 그 폴더로 복사 (선택한 폴더는 기기에 기억됨)
// · 복사된 첨부에는 localAt 표식 — 다음 복사 때 새 것만 담는다
// ============================================================================

const LocalFolder = (() => {
  const FOLDER = "항상예수께로";
  const DB = "bible-localdir", STORE = "handles";

  const isCap = () => !!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Filesystem);
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

  async function _writeCap(att) {
    const b64 = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(",")[1]);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(att.blob);
    });
    await Capacitor.Plugins.Filesystem.writeFile({
      path: `${FOLDER}/${_fileName(att)}`,
      data: b64,
      directory: "DOCUMENTS",
      recursive: true
    });
  }

  // ── 아직 복사 안 된 첨부 전부를 폴더로 ───────────────────────────────
  //  반환: { total, ok, fail, dest }  (dest: 사용자 안내용 위치 문구)
  async function copyAll(onProgress, forceNewDir) {
    if (!isSupported()) throw new Error("이 브라우저는 폴더 저장을 지원하지 않습니다 — 백업 zip의 첨부 포함 옵션을 이용해 주세요");
    const all = await AttachStore.listAll();
    const todo = all.filter(a => !a.localAt);
    let dir = null, dest;
    if (isCap()) dest = `문서(Documents)/${FOLDER}`;
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
    return { total: todo.length, ok, fail, dest };
  }

  return { FOLDER, isSupported, isCap, canPick, copyAll };
})();
