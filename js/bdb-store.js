// ============================================================================
// BdbStore - 사용자가 불러온 베들레헴 .bdb 파일을 IndexedDB에 보관
// ----------------------------------------------------------------------------
// · 원본 SQLite 바이트를 그대로 저장 (변환·재배포 없음, 사용자 기기 안에만)
// · 한 번 불러오면 이후 실행에서 자동 사용 (재선택 불필요)
// · list()는 메타(id·name·savedAt)만 localStorage에 캐시해 즉시 반환
//   (예전엔 openCursor가 거대한 bytes까지 매번 역직렬화 → 부팅 지연 원인)
// ============================================================================

const BdbStore = {
  DB_NAME: "bible-bdb-store",
  STORE: "bdbs",
  META_KEY: "bible-bdb-meta",   // localStorage 메타 캐시
  _db: null,
  _meta: null,       // 메모리 캐시
  _rebuildP: null,   // 진행 중인 재구축(single-flight)

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

  // ── 메타 캐시 ──────────────────────────────────────────────────────────
  _loadMeta() {
    if (this._meta) return this._meta;
    try { const m = JSON.parse(localStorage.getItem(this.META_KEY) || "null"); if (Array.isArray(m)) { this._meta = m; return m; } } catch (e) {}
    return null;
  },
  _saveMeta(list) {
    this._meta = list;
    try { localStorage.setItem(this.META_KEY, JSON.stringify(list)); } catch (e) {}
  },
  _invalidateMeta() {
    this._meta = null; this._rebuildP = null;
    try { localStorage.removeItem(this.META_KEY); } catch (e) {}
  },
  // 캐시가 없을 때 1회 커서 스캔으로 메타만 뽑아 캐시 (bytes는 무시)
  async _rebuildMeta() {
    const db = await this.db();
    const out = await new Promise((resolve, reject) => {
      const o = [];
      const cur = db.transaction(this.STORE).objectStore(this.STORE).openCursor();
      cur.onsuccess = e => { const c = e.target.result; if (c) { o.push({ id: c.value.id, name: c.value.name, savedAt: c.value.savedAt }); c.continue(); } else resolve(o); };
      cur.onerror = e => reject(e.target.error);
    });
    this._saveMeta(out);
    return out;
  },

  // id: "bdb:<slug>"  / name: 표시명  / bytes: Uint8Array | ArrayBuffer
  async save(id, name, bytes) {
    const db = await this.db();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readwrite");
      tx.objectStore(this.STORE).put({ id, name, bytes, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
    this._invalidateMeta();   // 다음 list()에서 재구축
  },

  // 메타데이터만 (바이트 제외) — 드롭다운·칩 판정용. 캐시 우선.
  async list() {
    const cached = this._loadMeta();
    const src = cached || await (this._rebuildP || (this._rebuildP = this._rebuildMeta()));
    return src.slice().sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  },

  // 바이트를 로드하지 않고 존재 여부만 (getKey)
  async has(id) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE).objectStore(this.STORE).getKey(id);
      req.onsuccess = e => resolve(e.target.result != null);
      req.onerror = e => reject(e.target.error);
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
    await new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readwrite");
      tx.objectStore(this.STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
    this._invalidateMeta();
  },
};
