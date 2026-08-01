// 데이터 내보내기 / 가져오기 (ZIP: 성경절 + 형광펜 + 암송로그 + 오디오 + 이미지 + 프로필 + 모듈)
const DataExchange = {

  _localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  // ※ 전체·앱별 백업은 js/backup-core.js(BackupCore)로 일원화되었다.
  //   예전에 여기 있던 exportZIP / importZIP / exportUnified / importUnified 는
  //   성경읽기 쪽 백업과 담는 범위가 겹쳐 서로 다른 규칙으로 중복되고 있었고,
  //   새 키(bible-prayer-texts 등)를 놓치기 쉬운 prefix 방식이라 제거했다.
  //   지금 이 모듈에 남은 것은 "내성경절만 JSON으로" 주고받는 기능뿐이다.

  // ── 내성경절 전용 내보내기 (JSON) — folderId를 주면 그 폴더 것만 ──
  exportVerses(folderId) {
    let data = UserVerseManager.load();
    let name = "내성경절";
    if (folderId) {
      const defId = (typeof UserFolderManager !== "undefined") ? UserFolderManager.getDefaultId() : null;
      data = data.filter(v => (v.folderId || defId) === folderId);
      const f = (typeof UserFolderManager !== "undefined") ? UserFolderManager.get(folderId) : null;
      if (f) name = `내성경절_${f.name}`;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${name}_${this._localDate()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ── 내성경절 전용 가져오기 (JSON, ID 기준 병합) ──
  //  folderId를 주면 가져온 항목을 전부 그 폴더로 담는다(원본 폴더 정보는 무시 —
  //  다른 기기·다른 폴더 구성에서 온 파일일 수 있어 "지금 보고 있는 폴더"가 더 예측 가능하다).
  async importVerses(file, folderId, onDone) {
    try {
      const text     = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error("올바른 형식이 아닙니다.");
      if (folderId) imported.forEach(v => { v.folderId = folderId; });
      const existing = UserVerseManager.load();
      const map      = Object.fromEntries(existing.map(v => [v.id, v]));
      imported.forEach(v => { map[v.id] = v; });
      UserVerseManager.save(Object.values(map));
      if (onDone) onDone();
    } catch(e) {
      alert("가져오기 실패: " + e.message);
    }
  },

};
