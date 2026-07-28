// ============================================================================
// AttachStore — 첨부파일 저장 (IndexedDB, 모든 모듈 공용)
// ----------------------------------------------------------------------------
// · owner 로 소속을 구분: "pray:<id>" | "uv:<id>" | "praise:<id>" | "share:<id>"
// · 사진·문서·스프레드시트 등 형식 제한 없음 (blob 그대로 보관)
// · 구글드라이브 복사는 DriveSync가 이 저장소를 읽어 업로드한다
// ============================================================================

const AttachStore = (() => {
  const DB_NAME = "bible-attachments", STORE = "files";

  function _db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("owner", "owner", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function _tx(mode, fn) {
    return _db().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      tx.onerror = () => reject(tx.error);
    }));
  }

  async function add(owner, file) {
    const rec = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      owner,
      name: file.name || "첨부",
      mime: file.type || "application/octet-stream",
      size: file.size || 0,
      blob: file,
      drive: null,                 // Drive 업로드 후 { fileId, at } 기록
      createdAt: Date.now()
    };
    await _tx("readwrite", os => os.put(rec));
    return rec;
  }

  function list(owner) {
    return _tx("readonly", os => os.index("owner").getAll(owner)).then(a => a || []);
  }

  function listAll() {
    return _tx("readonly", os => os.getAll()).then(a => a || []);
  }

  function get(id) { return _tx("readonly", os => os.get(id)); }
  // 백업 복원용 — 레코드를 id 그대로 되살린다 (upsert)
  function put(rec) { return _tx("readwrite", os => os.put(rec)); }
  function remove(id) { return _tx("readwrite", os => os.delete(id)); }
  function update(id, patch) {
    return get(id).then(rec => {
      if (!rec) return null;
      return _tx("readwrite", os => os.put(Object.assign({}, rec, patch)));
    });
  }
  function removeByOwner(owner) {
    return list(owner).then(arr => Promise.all(arr.map(a => remove(a.id))));
  }

  // 새 탭/뷰어로 열기
  async function open(id) {
    const rec = await get(id);
    if (!rec || !rec.blob) return false;
    const url = URL.createObjectURL(rec.blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  function fmtSize(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + "MB";
    if (n >= 1024) return Math.round(n / 1024) + "KB";
    return n + "B";
  }

  return { add, list, listAll, get, put, remove, removeByOwner, update, open, fmtSize };
})();
