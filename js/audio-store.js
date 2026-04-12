// IndexedDB 기반 오디오 저장소 + 마이크 녹음
const AudioStore = {
  DB_NAME: "bible-user-audio",
  STORE:   "audio",
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
    // 캐시된 URL 갱신
    if (this._urls[id]) { URL.revokeObjectURL(this._urls[id]); delete this._urls[id]; }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, "readwrite");
      tx.objectStore(this.STORE).put({ id, blob, mimeType: blob.type, savedAt: Date.now() });
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
  }
};

// 마이크 녹음 헬퍼
const VoiceRecorder = {
  _recorder: null,
  _chunks:   [],
  _stream:   null,
  isRecording: false,

  async start() {
    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this._chunks = [];
    const mime = ["audio/webm;codecs=opus","audio/mp4","audio/webm"]
      .find(t => MediaRecorder.isTypeSupported(t)) || "";
    this._recorder = new MediaRecorder(this._stream, mime ? { mimeType: mime } : {});
    this._recorder.ondataavailable = e => { if (e.data.size > 0) this._chunks.push(e.data); };
    this._recorder.start();
    this.isRecording = true;
  },

  stop() {
    return new Promise(resolve => {
      if (!this._recorder || !this.isRecording) { resolve(null); return; }
      this._recorder.onstop = () => {
        const blob = new Blob(this._chunks, { type: this._recorder.mimeType || "audio/webm" });
        this._stream.getTracks().forEach(t => t.stop());
        this._stream = null;
        this.isRecording = false;
        resolve(blob);
      };
      this._recorder.stop();
    });
  }
};
