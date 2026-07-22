// 데이터 내보내기 / 가져오기 (ZIP: 성경절 + 형광펜 + 암송로그 + 오디오 + 이미지 + 프로필 + 모듈)
const DataExchange = {

  _localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  async exportZIP() {
    if (typeof JSZip === "undefined") { alert("JSZip 로드 실패"); return; }
    const zip = new JSZip();
    await this._writeInto(zip);
    await this._downloadZip(zip, `성경절백업_${this._localDate()}.zip`);
  },

  // 통합 백업: 암송앱 + 읽기앱 데이터를 zip 하나로 (기기 이전·APK 갈아타기용)
  async exportUnified() {
    if (typeof JSZip === "undefined") { alert("JSZip 로드 실패"); return; }
    const zip = new JSZip();
    zip.file("unified.json", JSON.stringify({ app: "성경앱 통합백업", apps: ["성경절암송", "성경읽기"], version: 1, exportedAt: Date.now() }));
    await this._writeInto(zip.folder("memorize"));
    await this._writeReaderInto(zip.folder("reader"));
    await this._downloadZip(zip, `성경앱_통합백업_${this._localDate()}.zip`);
  },

  async _downloadZip(zip, name) {
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  },

  // 암송앱 데이터 파일들을 root(zip 또는 하위 폴더)에 기록
  async _writeInto(root) {
    // 1. 사용자 성경절
    root.file("verses.json",
      JSON.stringify(UserVerseManager.load(), null, 2));

    // 2. 즐겨찾기
    root.file("favorites.json",
      localStorage.getItem("bible-favorites") || "[]");

    // 3. 형광펜 데이터 (전체 분기/과)
    root.file("highlights.json",
      localStorage.getItem("bible-memory-highlights") || "{}");

    // 4. 암송 완료 로그
    root.file("memo-log.json",
      localStorage.getItem("bible-memo-log") || "{}");

    // 5. 사용자 프로필 (이름, 좋아하는 성경절)
    root.file("profile.json",
      localStorage.getItem("bible-user-profile") || "{}");

    // 6. 오디오 파일 (내 목소리 녹음, IndexedDB)
    const allAudio = await AudioStore.getAll();
    for (const item of allAudio) {
      const ext = item.mimeType?.includes("mp4") ? "m4a"
                : item.mimeType?.includes("ogg") ? "ogg" : "webm";
      root.file(`audio/${item.id}.${ext}`, item.blob);
    }

    // 7. 이미지 파일 (사용자 저장 이미지, IndexedDB)
    if (typeof ImageStore !== "undefined") {
      const allImages = await ImageStore.getAll();
      for (const item of allImages) {
        const mime = item.blob?.type || "image/jpeg";
        const ext  = mime.includes("png") ? "png"
                   : mime.includes("webp") ? "webp"
                   : mime.includes("gif") ? "gif" : "jpg";
        const safeId = item.id.replace(/:/g, "_");
        root.file(`images/${safeId}.${ext}`, item.blob);
        root.file(`images/${safeId}.meta.json`, JSON.stringify({ id: item.id }));
      }
    }

    // 8. 모듈 레지스트리 + 9. 설치 모듈 구절 데이터 (IndexedDB)
    if (typeof ModuleManager !== "undefined") {
      const registry = ModuleManager.getRegistry();
      root.file("module-registry.json", JSON.stringify(registry, null, 2));
      const installedMods = ModuleManager.getInstalledModules()
        .filter(m => !ModuleManager.isPermanent(m.moduleId));
      for (const mod of installedMods) {
        try {
          const data = await ModuleManager.getModuleData(mod.moduleId);
          if (data) root.file(`modules/${mod.moduleId}.json`, JSON.stringify(data));
        } catch(e) {
          console.warn(`[DataExchange] 모듈 내보내기 실패: ${mod.moduleId}`, e);
        }
      }
    }
  },

  // 읽기앱 데이터(localStorage bible-reader-* + 녹음 IndexedDB)를 root에 기록
  async _writeReaderInto(root) {
    const rlocal = {};
    for (const k of Object.keys(localStorage)) if (k.startsWith("bible-reader-")) rlocal[k] = localStorage.getItem(k);
    root.file("reader-local.json", JSON.stringify(rlocal));
    let recs = [];
    try { recs = await this._idbGetAll("bible-reader-recordings", "recs"); } catch(e) {}
    root.file("reader-recs.json", JSON.stringify(recs.map(({ blob, ...m }) => m)));
    const rf = root.folder("rec");
    for (const r of recs) if (r.blob) rf.file(r.id + ".bin", r.blob);
  },

  // ── 내성경절 전용 내보내기 (JSON) ──
  exportVerses() {
    const data = UserVerseManager.load();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `내성경절_${this._localDate()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ── 내성경절 전용 가져오기 (JSON, ID 기준 병합) ──
  async importVerses(file, onDone) {
    try {
      const text     = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error("올바른 형식이 아닙니다.");
      const existing = UserVerseManager.load();
      const map      = Object.fromEntries(existing.map(v => [v.id, v]));
      imported.forEach(v => { map[v.id] = v; });
      UserVerseManager.save(Object.values(map));
      if (onDone) onDone();
    } catch(e) {
      alert("가져오기 실패: " + e.message);
    }
  },

  async importZIP(file, onDone) {
    if (typeof JSZip === "undefined") { alert("JSZip 로드 실패"); return; }
    const result = { restoredModuleIds: [] };
    try {
      const zip = await JSZip.loadAsync(file);
      // 통합 백업이면 memorize/ 하위에서 읽음(레거시 단일 백업은 root)
      const memRoot = zip.file("unified.json") ? zip.folder("memorize") : zip;
      await this._readFrom(memRoot, result);
      if (onDone) onDone(result);
    } catch(e) {
      alert("가져오기 실패: " + e.message);
    }
  },

  // 통합 백업 가져오기: 암송 + 읽기 데이터 모두 복원(병합). 레거시 단일 백업도 허용.
  async importUnified(file, onDone) {
    if (typeof JSZip === "undefined") { alert("JSZip 로드 실패"); return; }
    const result = { restoredModuleIds: [], reader: false };
    try {
      const zip = await JSZip.loadAsync(file);
      const isUnified = !!zip.file("unified.json");
      await this._readFrom(isUnified ? zip.folder("memorize") : zip, result);
      if (isUnified) { await this._readReaderFrom(zip.folder("reader")); result.reader = true; }
      if (onDone) onDone(result);
    } catch(e) {
      alert("가져오기 실패: " + e.message);
    }
  },

  // 읽기앱 데이터 복원(병합) — reader.html의 _mergeLocalData와 동일 규칙
  async _readReaderFrom(root) {
    const lf = root.file("reader-local.json");
    if (lf) this._mergeReaderLocal(JSON.parse(await lf.async("text")));
    const mf = root.file("reader-recs.json");
    if (mf) {
      const meta = JSON.parse(await mf.async("text"));
      for (const m of meta) {
        const bf = root.file("rec/" + m.id + ".bin");
        if (!bf) continue;
        const blob = await bf.async("blob");
        try { await this._idbPut("bible-reader-recordings", "recs", { ...m, blob, mime: m.mime || blob.type }); } catch(e) {}
      }
    }
  },
  _mergeReaderLocal(local) {
    const parse = (s, d) => { try { const v = JSON.parse(s); return v == null ? d : v; } catch(e) { return d; } };
    for (const k in local) {
      if (k === "bible-reader-marks") {
        const cur = parse(localStorage.getItem(k), {}), inc = parse(local[k], {});
        Object.assign(cur, inc); localStorage.setItem(k, JSON.stringify(cur));
      } else if (k === "bible-reader-bookmarks") {
        const cur = parse(localStorage.getItem(k), []), inc = parse(local[k], []);
        const map = {}; [...cur, ...inc].forEach(b => { if (b && b.id) map[b.id] = b; });
        localStorage.setItem(k, JSON.stringify(Object.values(map)));
      } else if (k === "bible-reader-tongdok") {
        const cur = parse(localStorage.getItem(k), {}), inc = parse(local[k], {});
        const read = Object.assign({}, cur.read || {}, inc.read || {});
        const daily = Object.assign({}, cur.daily || {});
        for (const d in (inc.daily || {})) daily[d] = Array.from(new Set([...(daily[d] || []), ...inc.daily[d]]));
        localStorage.setItem(k, JSON.stringify({ read, daily }));
      } else {
        localStorage.setItem(k, local[k]);
      }
    }
  },

  // ── 범용 IndexedDB 헬퍼 (store keyPath: "id") ──
  _idbDB(dbName, store) {
    return new Promise((res, rej) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = e => { const db = e.target.result; if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" }); };
      req.onsuccess = e => res(e.target.result);
      req.onerror = e => rej(e.target.error);
    });
  },
  async _idbGetAll(dbName, store) {
    const db = await this._idbDB(dbName, store);
    return new Promise((res, rej) => {
      let tx; try { tx = db.transaction(store); } catch(e) { res([]); return; }
      const req = tx.objectStore(store).getAll();
      req.onsuccess = e => res(e.target.result || []);
      req.onerror = e => rej(e.target.error);
    });
  },
  async _idbPut(dbName, store, rec) {
    const db = await this._idbDB(dbName, store);
    return new Promise((res, rej) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(rec); tx.oncomplete = () => res(); tx.onerror = e => rej(e.target.error); });
  },

  // 암송앱 데이터 파일들을 root(zip 또는 하위 폴더)에서 복원(병합)
  async _readFrom(root, result) {
    {
      const zip = root;

      // 1. 사용자 성경절 (병합: ID 기준)
      const vf = zip.file("verses.json");
      if (vf) {
        const imported = JSON.parse(await vf.async("text"));
        const existing = UserVerseManager.load();
        const map = Object.fromEntries(existing.map(v => [v.id, v]));
        imported.forEach(v => { map[v.id] = v; });
        UserVerseManager.save(Object.values(map));
      }

      // 2. 형광펜 (병합)
      const hf = zip.file("highlights.json");
      if (hf) {
        const imported = JSON.parse(await hf.async("text"));
        const existing = JSON.parse(
          localStorage.getItem("bible-memory-highlights") || "{}"
        );
        Object.assign(existing, imported);
        localStorage.setItem("bible-memory-highlights", JSON.stringify(existing));
        if (typeof HighlightManager !== "undefined") HighlightManager.load();
      }

      // 3. 암송 로그 (병합: 높은 count 우선)
      const mf = zip.file("memo-log.json");
      if (mf) {
        const imported = JSON.parse(await mf.async("text"));
        const existing = MemoLog.getAll();
        Object.entries(imported).forEach(([k, v]) => {
          if (!existing[k] || v.count > (existing[k].count || 0)) {
            existing[k] = v;
          }
        });
        MemoLog.saveAll(existing);
      }

      // 4. 즐겨찾기
      const ff = zip.file("favorites.json");
      if (ff) {
        localStorage.setItem("bible-favorites", await ff.async("text"));
      }

      // 5. 사용자 프로필 (이전 버전 누락 항목)
      const pf = zip.file("profile.json");
      if (pf) {
        const raw = await pf.async("text");
        // 기존 프로필과 병합 (이름 등 덮어쓰지 않고 빈 항목만 보충)
        try {
          const imported = JSON.parse(raw);
          const existing = JSON.parse(localStorage.getItem("bible-user-profile") || "{}");
          const merged   = Object.assign({}, imported, existing); // 기존 값 우선
          localStorage.setItem("bible-user-profile", JSON.stringify(merged));
        } catch(e) {}
      }

      // 6. 오디오 (IndexedDB에 저장)
      const audioDir = zip.folder("audio");
      if (audioDir) {
        const tasks = [];
        audioDir.forEach((relPath, zf) => {
          if (zf.dir) return;
          const id = relPath.replace(/\.[^.]+$/, "");
          tasks.push(zf.async("blob").then(blob => AudioStore.save(id, blob)));
        });
        await Promise.all(tasks);
      }

      // 7. 이미지 (IndexedDB에 저장) ← 이전 버전 누락 항목
      if (typeof ImageStore !== "undefined") {
        const imagesDir = zip.folder("images");
        if (imagesDir) {
          // 먼저 .meta.json 파일들을 모아서 id 매핑 구축
          const metaMap = {}; // safeId → originalId
          const metaTasks = [];
          imagesDir.forEach((relPath, zf) => {
            if (zf.dir || !relPath.endsWith(".meta.json")) return;
            metaTasks.push(
              zf.async("text").then(text => {
                try {
                  const m = JSON.parse(text);
                  if (m.id) {
                    const safeId = relPath.replace(/\.meta\.json$/, "");
                    metaMap[safeId] = m.id;
                  }
                } catch(e) {}
              })
            );
          });
          await Promise.all(metaTasks);

          // 이미지 blob 복원
          const imgTasks = [];
          imagesDir.forEach((relPath, zf) => {
            if (zf.dir || relPath.endsWith(".meta.json")) return;
            const safeId = relPath.replace(/\.[^.]+$/, "");
            const originalId = metaMap[safeId] || safeId.replace(/_/g, ":");
            imgTasks.push(
              zf.async("blob").then(blob => ImageStore.save(originalId, blob))
            );
          });
          await Promise.all(imgTasks);
        }
      }

      // 8. 모듈 레지스트리 병합
      if (typeof ModuleManager !== "undefined") {
        const rf = zip.file("module-registry.json");
        if (rf) {
          const importedReg = JSON.parse(await rf.async("text"));
          const newModuleIds = ModuleManager.mergeRegistryFrom(importedReg);
          result.restoredModuleIds = newModuleIds;
        }

        // 9. 모듈 구절 데이터 복원 (IndexedDB)
        const modulesFolder = zip.folder("modules");
        if (modulesFolder) {
          const tasks = [];
          modulesFolder.forEach((relPath, zf) => {
            if (zf.dir || !relPath.endsWith(".json")) return;
            const moduleId = relPath.replace(/\.json$/, "");
            tasks.push(
              zf.async("text").then(async text => {
                try {
                  const data = JSON.parse(text);
                  await ModuleManager.saveModuleData(moduleId, data);
                } catch(e) {
                  console.warn(`[DataExchange] 모듈 복원 실패: ${moduleId}`, e);
                }
              })
            );
          });
          await Promise.all(tasks);
        }
      }
    }
  }
};
