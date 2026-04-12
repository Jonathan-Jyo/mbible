// IndexedDB 기반 이미지 저장소
// 키 형식: "img:{quarter}:{lesson}"
const ImageStore = {
  DB_NAME: "bible-user-images",
  STORE:   "images",
  _db:     null,
  _urls:   {},

  async db() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, 1);
      req.onupgradeneeded = e =>
        e.target.result.createObjectStore(this.STORE, { keyPath: "id" });
      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror   = e => reject(e.target.error);
    });
  },

  async save(id, blob) {
    const db = await this.db();
    if (this._urls[id]) { URL.revokeObjectURL(this._urls[id]); delete this._urls[id]; }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readwrite");
      tx.objectStore(this.STORE).put({ id, blob, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  },

  async getURL(id) {
    if (this._urls[id]) return this._urls[id];
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE).objectStore(this.STORE).get(id);
      req.onsuccess = e => {
        if (!e.target.result) { resolve(null); return; }
        const url = URL.createObjectURL(e.target.result.blob);
        this._urls[id] = url;
        resolve(url);
      };
      req.onerror = e => reject(e.target.error);
    });
  },

  async delete(id) {
    if (this._urls[id]) { URL.revokeObjectURL(this._urls[id]); delete this._urls[id]; }
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readwrite");
      tx.objectStore(this.STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  },

  async getAll() {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.STORE).objectStore(this.STORE).getAll();
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  },

  // ── 이미지 압축 ──────────────────────────────────────────
  // • maxDimension: 가로/세로 최대 픽셀 (기본 1200)
  // • quality: JPEG 품질 (0~1, 기본 0.82)
  // • maxFileMB: 원본 파일 최대 크기 (기본 4MB)
  compress(file, { maxDimension = 1200, quality = 0.82, maxFileMB = 4 } = {}) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("이미지 파일만 첨부할 수 있습니다.")); return;
      }
      if (file.size > maxFileMB * 1024 * 1024) {
        reject(new Error(`${maxFileMB}MB 이하의 이미지 파일을 선택해 주세요.`)); return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxDimension || h > maxDimension) {
            const ratio = Math.min(maxDimension / w, maxDimension / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width  = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          canvas.toBlob(blob => {
            if (!blob) { reject(new Error("이미지 변환에 실패했습니다.")); return; }
            resolve(blob);
          }, "image/jpeg", quality);
        };
        img.onerror = () => reject(new Error("이미지를 불러올 수 없습니다."));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error("파일 읽기에 실패했습니다."));
      reader.readAsDataURL(file);
    });
  }
};
