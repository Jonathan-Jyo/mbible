// ============================================================================
// BdbStore - 사용자가 불러온 베들레헴 .bdb 파일을 IndexedDB에 보관
// ----------------------------------------------------------------------------
// · 원본 SQLite 바이트를 그대로 저장 (변환·재배포 없음, 사용자 기기 안에만)
// · 한 번 불러오면 이후 실행에서 자동 사용 (재선택 불필요)
// · list()는 메타(id·name·savedAt)만 localStorage에 캐시해 즉시 반환
//   (예전엔 openCursor가 거대한 bytes까지 매번 역직렬화 → 부팅 지연 원인)
// · 캐시가 없을 때도 열쇠만 읽어 만든다 · 불러오기·지우기는 캐시를 그 자리에서 고친다 (v4.33.9 — 소형폰에서 앱이 꺼지던 원인)
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
  // 캐시가 없을 때 — **열쇠(id)만** 읽어 메타를 만든다 (v4.33.9)
  // 예전에는 openCursor 로 값을 하나씩 읽었는데, 값에는 자료 바이트(찬미가 악보 묶음 등)가 통째로 들어 있어
  // 저장된 자료 전체(S45 Pro 는 261MB)가 한꺼번에 메모리에 올라왔다. 2GB 폰은 다 읽기 전에 꺼졌고,
  // 그래서 캐시가 끝내 저장되지 않아 성경읽기를 열 때마다 되풀이됐다(2026-11-26 기록판으로 찾음).
  // 이름은 id 에서 얻는다 — id 는 "종류:이름"(dataset-import 의 storeDb). 불러온 때는 모르므로 0
  async _rebuildMeta() {
    const db = await this.db();
    const keys = await new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE).objectStore(this.STORE).getAllKeys();
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror = e => reject(e.target.error);
    });
    const out = keys.map(id => ({ id: String(id), name: this.nameOf(id), savedAt: 0 }));
    this._saveMeta(out);
    return out;
  },
  // id("종류:이름") → 이름
  nameOf(id) { const s = String(id); const i = s.indexOf(":"); return i >= 0 ? s.slice(i + 1) : s; },

  // id: "bdb:<slug>"  / name: 표시명  / bytes: Uint8Array | ArrayBuffer
  async save(id, name, bytes) {
    const db = await this.db();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readwrite");
      tx.objectStore(this.STORE).put({ id, name, bytes, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
    // 캐시를 지우지 않고 그 자리에서 고친다 — 지우면 다음 list() 가 다시 만들어야 한다(v4.33.9)
    this._patchMeta(id, { id, name, savedAt: Date.now() });
  },
  // 캐시에 한 줄을 넣거나 바꾸거나(item 이 null 이면) 뺀다. 캐시가 아직 없으면 그대로 둔다(list 가 열쇠만으로 만든다)
  _patchMeta(id, item) {
    const cur = this._loadMeta();
    if (!cur) return;
    const next = cur.filter(x => x.id !== id);
    if (item) next.push(item);
    this._saveMeta(next);
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
    this._patchMeta(id, null);
  },
};
