// ══════════════════════════════════════════════════════════════
// ModuleManager — 성경절 암송 모듈 관리자 (Phase 1: 기반 인프라)
//
// 역할:
//   · localStorage   : 모듈 레지스트리 (메타데이터 / 상태)
//   · IndexedDB      : 구절 데이터 (bible-modules)
//   · install / remove / backup / restore API 제공
//   · 레거시 JS 데이터 → IndexedDB 자동 마이그레이션
//
// 영구 모듈 (삭제 불가): favorites, user, yeongyeol
// 설치형 모듈 예시      : 2026-01 ~ 2026-04, bible-topic-set-1 등
// ══════════════════════════════════════════════════════════════

const ModuleManager = (() => {

  // ── 상수 ────────────────────────────────────────────────────
  const REGISTRY_KEY  = "bible-module-registry";
  const DB_NAME       = "bible-modules";
  const STORE_NAME    = "modules";
  const DB_VERSION    = 1;
  // favorites / user 는 항상 내장 — yeongyeol 은 일반 모듈(삭제·백업 가능)
  const PERMANENT     = new Set(["favorites", "user"]);

  let _db = null;

  // ── IndexedDB 초기화 ─────────────────────────────────────────
  function _openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "moduleId" });
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  // ── Registry (localStorage) ──────────────────────────────────
  function _loadReg() {
    try {
      const raw = localStorage.getItem(REGISTRY_KEY);
      if (!raw) return _defaultReg();
      return JSON.parse(raw);
    } catch(e) { return _defaultReg(); }
  }

  function _saveReg(reg) {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
  }

  function _defaultReg() {
    return { version: 1, modules: {}, statsArchive: {} };
  }

  // ── 매니페스트 자동 생성 (레거시 데이터에서) ─────────────────
  function _buildManifest(quarterKey, data) {
    const lessons = data.lessons || [];
    const firstVerse = lessons[0]?.verse || {};
    const langs = Object.keys(firstVerse).filter(Boolean);

    let shortName  = quarterKey;
    let sortOrder  = 50;
    const m = quarterKey.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      shortName  = `${m[1]}년 ${parseInt(m[2])}기`;
      sortOrder  = parseInt(m[1]) * 100 + parseInt(m[2]);
    }

    return {
      moduleId    : quarterKey,
      version     : "1.0.0",
      type        : m ? "quarterly" : "custom",
      permanent   : false,
      shortName,
      displayName : (data.title?.ko) || shortName,
      quarterKeys : [quarterKey],
      lessonCount : lessons.length,
      languages   : langs.length ? langs : ["ko"],
      hasAudio    : lessons.some(l => l.audio),
      hasImages   : false,
      estimatedSizeKB: 0,
      sortOrder
    };
  }

  // ══════════════════════════════════════════════════════════════
  // 공개 API
  // ══════════════════════════════════════════════════════════════
  return {

    // ── 초기화 (앱 시작 시 호출) ───────────────────────────────
    async init() {
      try { await _openDB(); return true; }
      catch(e) { console.warn("[ModuleManager] IndexedDB 초기화 실패:", e); return false; }
    },

    // ── Registry 조회 ──────────────────────────────────────────
    getRegistry()        { return _loadReg(); },
    getModule(id)        { return _loadReg().modules[id] || null; },

    getInstalledModules() {
      const reg = _loadReg();
      return Object.values(reg.modules)
        .filter(m => m.status === "installed")
        .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
    },

    // 설치된 모듈의 quarterKey 목록 (VERSES 키 순서 결정용)
    getInstalledQuarterKeys() {
      return this.getInstalledModules().flatMap(m => m.quarterKeys || []);
    },

    isPermanent(id) { return PERMANENT.has(id); },

    // "installed" 상태일 때만 true — "backed-up" 은 false → 앱 재로드 시 자동 재등록
    isMigrated(id)  { return _loadReg().modules[id]?.status === "installed"; },

    // ── 내장 모듈 강제 재설치 ────────────────────────────────────
    // 파일 없이 window.VERSES_* 데이터로 바로 재설치
    async reinstallBuiltin(quarterKey, data) {
      const manifest  = _buildManifest(quarterKey, data);
      const moduleData = { [quarterKey]: data };
      await this.saveModuleData(quarterKey, moduleData);
      const reg = _loadReg();
      reg.modules[quarterKey] = {
        ...manifest,
        status       : "installed",
        installedAt  : new Date().toISOString(),
        reinstalledAt: new Date().toISOString()
      };
      _saveReg(reg);
      return true;
    },

    // ── 모듈 메타 업데이트 (이름·순서 등 Registry 내 필드 수정) ──
    updateModuleMeta(moduleId, meta) {
      const reg = _loadReg();
      if (!reg.modules[moduleId]) return false;
      Object.assign(reg.modules[moduleId], meta);
      _saveReg(reg);
      return true;
    },

    // ── IndexedDB: 구절 데이터 저장 / 조회 / 삭제 ─────────────
    async saveModuleData(moduleId, data) {
      const db = await _openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put({ moduleId, data, savedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror    = (e) => reject(e.target.error);
      });
    },

    async getModuleData(moduleId) {
      const db = await _openDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME)
          .objectStore(STORE_NAME).get(moduleId);
        req.onsuccess = (e) => resolve(e.target.result?.data ?? null);
        req.onerror   = (e) => reject(e.target.error);
      });
    },

    async deleteModuleData(moduleId) {
      const db = await _openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(moduleId);
        tx.oncomplete = () => resolve();
        tx.onerror    = (e) => reject(e.target.error);
      });
    },

    async getAllStoredModuleIds() {
      const db = await _openDB();
      return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME)
          .objectStore(STORE_NAME).getAllKeys();
        req.onsuccess = (e) => resolve(e.target.result || []);
        req.onerror   = (e) => reject(e.target.error);
      });
    },

    // ── 설치 ──────────────────────────────────────────────────
    // moduleJson: { manifest, data }
    async install(moduleJson) {
      const { manifest, data } = moduleJson;
      if (!manifest?.moduleId || !data) {
        throw new Error("유효하지 않은 모듈 파일입니다.");
      }
      const id = manifest.moduleId;

      await this.saveModuleData(id, data);

      // shortName 자동 보정: 모듈 빌더에서 shortName 이 없거나 moduleId 와 같을 때
      // manifest.name.ko → manifest.name.en → moduleId 순서로 대체
      const resolvedShortName =
        manifest.shortName ||
        manifest.name?.ko  ||
        manifest.name?.en  ||
        id;

      const reg = _loadReg();
      reg.modules[id] = {
        ...manifest,
        shortName  : resolvedShortName,
        displayName: manifest.displayName || resolvedShortName,
        // quarterKeys 가 없으면 moduleId 자체를 quarterKey 로 사용
        // (렌더링 시 VERSES[moduleId] 접근에 필요)
        quarterKeys: manifest.quarterKeys?.length ? manifest.quarterKeys : [id],
        status     : "installed",
        installedAt: new Date().toISOString()
      };
      _saveReg(reg);
      return true;
    },

    // ── 제거 ──────────────────────────────────────────────────
    // 통계는 statsArchive에 보존, 나머지(음성·이미지·형광펜)는
    // createBackup()으로 사전 백업 후 외부에서 삭제 처리
    async remove(moduleId) {
      if (PERMANENT.has(moduleId)) {
        throw new Error("영구 모듈은 제거할 수 없습니다.");
      }
      // 통계 아카이브 (MemoLog 데이터 보존)
      this._archiveStats(moduleId);

      // IndexedDB 구절 데이터 삭제
      await this.deleteModuleData(moduleId);

      // 형광펜 삭제
      const mod = this.getModule(moduleId);
      if (mod?.quarterKeys) {
        this._removeHighlights(mod.quarterKeys);
      }

      // Registry 상태 갱신
      const reg = _loadReg();
      if (reg.modules[moduleId]) {
        reg.modules[moduleId].status    = "backed-up";
        reg.modules[moduleId].removedAt = new Date().toISOString();
      }
      _saveReg(reg);
      return true;
    },

    // ── 복원 ──────────────────────────────────────────────────
    // backupJson: { manifest, data, userData?, audioBlobs?, imageBlobs? }
    async restore(backupJson, { includeUserData = true } = {}) {
      const { manifest, data } = backupJson;
      if (!manifest?.moduleId || !data) {
        throw new Error("유효하지 않은 백업 파일입니다.");
      }
      // 구절 데이터 설치
      await this.install({ manifest, data });

      // 사용자 데이터 복원
      if (includeUserData) {
        await this._restoreUserData(manifest.moduleId, backupJson);
      }

      // statsArchive → MemoLog 병합
      this._mergeArchiveStats(manifest.moduleId);
      return true;
    },

    // ── 백업 번들 생성 ─────────────────────────────────────────
    // includeMedia: true → 음성·이미지 blob 포함 (파일 커짐)
    async createBackup(moduleId, { includeMedia = false } = {}) {
      const mod = this.getModule(moduleId);
      if (!mod) throw new Error("모듈을 찾을 수 없습니다: " + moduleId);

      const data        = await this.getModuleData(moduleId);
      const quarterKeys = mod.quarterKeys || [];

      // 형광펜
      const highlights = this._collectHighlights(quarterKeys);

      // MemoLog
      const memoLog = this._collectMemoLog(quarterKeys);

      const bundle = {
        manifest  : { ...mod },
        data,
        userData  : { highlights, memoLog },
        exportedAt: new Date().toISOString()
      };

      if (includeMedia) {
        bundle.audioBlobs = await this._collectAudioBlobs(quarterKeys);
        bundle.imageBlobs = await this._collectImageBlobs(quarterKeys);
      }

      return bundle;
    },

    // ── 다운로드 헬퍼 ─────────────────────────────────────────
    downloadBackup(bundle) {
      const id   = bundle.manifest?.moduleId || "module";
      const date = new Date().toISOString().slice(0,10);
      const json = JSON.stringify(bundle, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `모듈백업_${id}_${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },

    // ── ZIP 백업에서 Registry 병합 (importZIP 전용) ───────────
    // 반환값: 이 기기에 새로 추가된 moduleId 목록
    mergeRegistryFrom(importedReg) {
      if (!importedReg?.modules) return [];
      const existing = _loadReg();

      // 모듈 병합: 로컬에 이미 installed 된 것은 유지, 새 모듈만 추가
      const merged = { ...(importedReg.modules || {}) };
      Object.entries(existing.modules).forEach(([id, mod]) => {
        if (mod.status === "installed") merged[id] = mod; // 로컬 설치 우선
      });

      // statsArchive 병합: 높은 count 유지
      const mergedStats = { ...(importedReg.statsArchive || {}) };
      Object.entries(existing.statsArchive || {}).forEach(([modId, archive]) => {
        if (!mergedStats[modId]) {
          mergedStats[modId] = archive;
        } else {
          Object.entries(archive).forEach(([k, v]) => {
            if (!mergedStats[modId][k] ||
                v.count > (mergedStats[modId][k]?.count || 0)) {
              mergedStats[modId][k] = v;
            }
          });
        }
      });

      _saveReg({
        version     : importedReg.version || 1,
        modules     : merged,
        statsArchive: mergedStats
      });

      // 이 기기에 새로 설치된 모듈 목록 반환
      return Object.entries(merged)
        .filter(([id, m]) =>
          m.status === "installed" &&
          !PERMANENT.has(id) &&
          !(existing.modules[id]?.status === "installed"))
        .map(([id]) => id);
    },

    // ── 레거시 자동 마이그레이션 ──────────────────────────────
    // DataLoader 가 window.VERSES_XXXX 를 VERSES 에 병합한 직후 호출
    async migrateFromLegacy(quarterKey, data) {
      if (this.isMigrated(quarterKey)) return; // 이미 등록됨

      const manifest = _buildManifest(quarterKey, data);
      const moduleData = { [quarterKey]: data };

      await this.saveModuleData(quarterKey, moduleData);

      const reg = _loadReg();
      reg.modules[quarterKey] = {
        ...manifest,
        status              : "installed",
        installedAt         : new Date().toISOString(),
        migratedFromLegacy  : true
      };
      _saveReg(reg);
    },

    // ── 아카이브된 통계 조회 (통계 탭 "제거된 모듈" 섹션용) ───
    getArchivedStats() {
      const reg = _loadReg();
      const result = [];

      Object.entries(reg.modules).forEach(([id, manifest]) => {
        if (manifest.status !== "backed-up") return;
        const archive = reg.statsArchive[id] || {};
        if (!Object.keys(archive).length) return;

        let total = 0, checked = 0, proficient = 0;
        Object.values(archive).forEach(v => {
          total++;
          if ((v.count || 0) >= 1) checked++;
          if ((v.count || 0) >= 5) proficient++;
        });
        result.push({ moduleId: id, shortName: manifest.shortName || id,
          total, checked, proficient });
      });

      return result;
    },

    // ══════════════════════════════════════════════════════════
    // 내부 헬퍼
    // ══════════════════════════════════════════════════════════

    // 형광펜 수집 (quarterKeys 기반)
    _collectHighlights(quarterKeys) {
      try {
        const all = JSON.parse(localStorage.getItem("bible-memory-highlights") || "{}");
        const out = {};
        Object.entries(all).forEach(([k, v]) => {
          if (quarterKeys.some(q => k.startsWith(q + "|") || k.startsWith(q + ":"))) {
            out[k] = v;
          }
        });
        return out;
      } catch(e) { return {}; }
    },

    // 형광펜 삭제
    _removeHighlights(quarterKeys) {
      try {
        const all = JSON.parse(localStorage.getItem("bible-memory-highlights") || "{}");
        Object.keys(all).forEach(k => {
          if (quarterKeys.some(q => k.startsWith(q + "|") || k.startsWith(q + ":"))) {
            delete all[k];
          }
        });
        localStorage.setItem("bible-memory-highlights", JSON.stringify(all));
      } catch(e) {}
    },

    // MemoLog 수집 (quarterKeys 기반)
    _collectMemoLog(quarterKeys) {
      try {
        const all = JSON.parse(localStorage.getItem("bible-memo-log") || "{}");
        const out = {};
        Object.entries(all).forEach(([k, v]) => {
          const [q] = k.split("|");
          if (quarterKeys.includes(q)) out[k] = v;
        });
        return out;
      } catch(e) { return {}; }
    },

    // MemoLog 아카이브 저장
    _archiveStats(moduleId) {
      const mod = this.getModule(moduleId);
      if (!mod?.quarterKeys) return;
      try {
        const memoLog = _collectMemoLogByKeys(mod.quarterKeys);
        const reg = _loadReg();
        reg.statsArchive[moduleId] = memoLog;
        _saveReg(reg);
      } catch(e) {}

      function _collectMemoLogByKeys(keys) {
        try {
          const all = JSON.parse(localStorage.getItem("bible-memo-log") || "{}");
          const out = {};
          Object.entries(all).forEach(([k, v]) => {
            const [q] = k.split("|");
            if (keys.includes(q)) out[k] = v;
          });
          return out;
        } catch(e) { return {}; }
      }
    },

    // statsArchive → MemoLog 병합 (복원 시)
    _mergeArchiveStats(moduleId) {
      const reg = _loadReg();
      const archive = reg.statsArchive[moduleId];
      if (!archive) return;
      try {
        const memoLog = JSON.parse(localStorage.getItem("bible-memo-log") || "{}");
        Object.entries(archive).forEach(([k, v]) => {
          if (!memoLog[k] || v.count > (memoLog[k].count || 0)) memoLog[k] = v;
        });
        localStorage.setItem("bible-memo-log", JSON.stringify(memoLog));
        delete reg.statsArchive[moduleId];
        _saveReg(reg);
      } catch(e) {}
    },

    // 음성 Blob 수집
    async _collectAudioBlobs(quarterKeys) {
      const out = {};
      try {
        const all = await AudioStore.getAll();
        for (const item of all) {
          if (quarterKeys.some(q => item.id.includes(q))) {
            out[item.id] = await this._blobToDataUrl(item.blob);
          }
        }
      } catch(e) {}
      return out;
    },

    // 이미지 Blob 수집
    async _collectImageBlobs(quarterKeys) {
      const out = {};
      try {
        const all = await ImageStore.getAll();
        for (const item of all) {
          if (quarterKeys.some(q => item.id.includes(q))) {
            out[item.id] = await this._blobToDataUrl(item.blob);
          }
        }
      } catch(e) {}
      return out;
    },

    // 사용자 데이터 복원
    async _restoreUserData(moduleId, bundle) {
      const { userData } = bundle;
      if (!userData) return;

      // 형광펜 병합
      if (userData.highlights && Object.keys(userData.highlights).length) {
        try {
          const cur = JSON.parse(localStorage.getItem("bible-memory-highlights") || "{}");
          Object.assign(cur, userData.highlights);
          localStorage.setItem("bible-memory-highlights", JSON.stringify(cur));
        } catch(e) {}
      }

      // MemoLog 병합 (높은 값 우선)
      if (userData.memoLog && Object.keys(userData.memoLog).length) {
        try {
          const cur = JSON.parse(localStorage.getItem("bible-memo-log") || "{}");
          Object.entries(userData.memoLog).forEach(([k, v]) => {
            if (!cur[k] || v.count > (cur[k].count || 0)) cur[k] = v;
          });
          localStorage.setItem("bible-memo-log", JSON.stringify(cur));
        } catch(e) {}
      }

      // 음성 Blob 복원
      if (bundle.audioBlobs) {
        for (const [id, dataUrl] of Object.entries(bundle.audioBlobs)) {
          try {
            const blob = await this._dataUrlToBlob(dataUrl);
            await AudioStore.save(id, blob);
          } catch(e) { console.warn("[ModuleManager] 음성 복원 실패:", id, e); }
        }
      }

      // 이미지 Blob 복원
      if (bundle.imageBlobs) {
        for (const [id, dataUrl] of Object.entries(bundle.imageBlobs)) {
          try {
            const blob = await this._dataUrlToBlob(dataUrl);
            await ImageStore.save(id, blob);
          } catch(e) { console.warn("[ModuleManager] 이미지 복원 실패:", id, e); }
        }
      }
    },

    // Blob ↔ DataURL 변환
    _blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(r.result);
        r.onerror = () => reject(new Error("Blob 변환 실패"));
        r.readAsDataURL(blob);
      });
    },

    async _dataUrlToBlob(dataUrl) {
      const res = await fetch(dataUrl);
      return res.blob();
    }

  }; // end return
})();
