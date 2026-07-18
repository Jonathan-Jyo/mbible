// ============================================================================
// BdbStore - 사용자가 불러온 베들레헴 .bdb 파일을 IndexedDB에 보관
// ----------------------------------------------------------------------------
// · 원본 SQLite 바이트를 그대로 저장 (변환·재배포 없음, 사용자 기기 안에만)
// · 한 번 불러오면 이후 실행에서 자동 사용 (재선택 불필요)
// ============================================================================

const BdbStore = {
  DB_NAME: "bible-bdb-store",
  STORE: "bdbs",
  _db: null,

  async db() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = e =>
        e.target.result.createObjectStore(this.STORE, { keyPath: "id" });
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror = e => reject(e.target.error);
    });
  },

  // id: "bdb:<slug>"  / name: 표시명  / bytes: Uint8Array | ArrayBuffer
  async save(id, name, bytes) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readwrite");
      tx.objectStore(this.STORE).put({ id, name, bytes, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
  },

  // 메타데이터만 (바이트 제외) — 드롭다운 채우기용
  async list() {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const out = [];
      const cur = db.transaction(this.STORE).objectStore(this.STORE).openCursor();
      cur.onsuccess = e => {
        const c = e.target.result;
        if (c) { out.push({ id: c.value.id, name: c.value.name, savedAt: c.value.savedAt }); c.continue(); }
        else resolve(out.sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0)));
      };
      cur.onerror = e => reject(e.target.error);
    });
  },

  async getBytes(id) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE).objectStore(this.STORE).get(id);
      req.onsuccess = e => resolve(e.target.result ? e.target.result.bytes : null);
      req.onerror = e => reject(e.target.error);
    });
  },

  async remove(id) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readwrite");
      tx.objectStore(this.STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
  },
};
