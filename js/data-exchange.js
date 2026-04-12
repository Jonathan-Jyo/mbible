// 데이터 내보내기 / 가져오기 (ZIP: 성경절 + 형광펜 + 암송로그 + 오디오 + 이미지 + 프로필 + 모듈)
const DataExchange = {

  _localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  async exportZIP() {
    if (typeof JSZip === "undefined") { alert("JSZip 로드 실패"); return; }
    const zip = new JSZip();

    // 1. 사용자 성경절
    zip.file("verses.json",
      JSON.stringify(UserVerseManager.load(), null, 2));

    // 2. 즐겨찾기
    zip.file("favorites.json",
      localStorage.getItem("bible-favorites") || "[]");

    // 3. 형광펜 데이터 (전체 분기/과)
    zip.file("highlights.json",
      localStorage.getItem("bible-memory-highlights") || "{}");

    // 4. 암송 완료 로그
    zip.file("memo-log.json",
      localStorage.getItem("bible-memo-log") || "{}");

    // 5. 사용자 프로필 (이름, 좋아하는 성경절)
    zip.file("profile.json",
      localStorage.getItem("bible-user-profile") || "{}");

    // 6. 오디오 파일 (내 목소리 녹음, IndexedDB)
    const allAudio = await AudioStore.getAll();
    for (const item of allAudio) {
      const ext = item.mimeType?.includes("mp4") ? "m4a"
                : item.mimeType?.includes("ogg") ? "ogg" : "webm";
      zip.file(`audio/${item.id}.${ext}`, item.blob);
    }

    // 7. 이미지 파일 (사용자 저장 이미지, IndexedDB) ← 이전 버전 누락 항목
    if (typeof ImageStore !== "undefined") {
      const allImages = await ImageStore.getAll();
      for (const item of allImages) {
        // blob의 MIME 타입에서 확장자 추출 (image/jpeg → jpg, image/png → png, etc.)
        const mime = item.blob?.type || "image/jpeg";
        const ext  = mime.includes("png") ? "png"
                   : mime.includes("webp") ? "webp"
                   : mime.includes("gif") ? "gif" : "jpg";
        // id 예: "img:long-set1:1" → 파일명 안전 처리
        const safeId = item.id.replace(/:/g, "_");
        zip.file(`images/${safeId}.${ext}`, item.blob);
        // 원본 id를 메타 파일에 기록 (복원 시 id 재매핑용)
        zip.file(`images/${safeId}.meta.json`,
          JSON.stringify({ id: item.id }));
      }
    }

    // 8. 모듈 레지스트리 (ModuleManager registry)
    if (typeof ModuleManager !== "undefined") {
      const registry = ModuleManager.getRegistry();
      zip.file("module-registry.json", JSON.stringify(registry, null, 2));

      // 9. 설치된 모듈 구절 데이터 (영구 모듈 제외, IndexedDB)
      const installedMods = ModuleManager.getInstalledModules()
        .filter(m => !ModuleManager.isPermanent(m.moduleId));

      for (const mod of installedMods) {
        try {
          const data = await ModuleManager.getModuleData(mod.moduleId);
          if (data) {
            zip.file(
              `modules/${mod.moduleId}.json`,
              JSON.stringify(data)
            );
          }
        } catch(e) {
          console.warn(`[DataExchange] 모듈 내보내기 실패: ${mod.moduleId}`, e);
        }
      }
    }

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE",
                                           compressionOptions: { level: 6 } });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `성경절백업_${this._localDate()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
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

      if (onDone) onDone(result);
    } catch(e) {
      alert("가져오기 실패: " + e.message);
    }
  }
};
