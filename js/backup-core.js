// ============================================================================
// BackupCore — 앱별·전체 백업을 한 규칙으로 다루는 공용 모듈
// ----------------------------------------------------------------------------
// 지금까지 백업이 성경읽기·성경암송 두 곳에 각자 흩어져 있었고, 서로 다른
// 규칙으로 겹치게 담고 있었다. 여기서 "무엇이 어느 앱 데이터인가"를 한 곳에
// 정의해 두고, 허브(전체)와 각 앱(부분)이 같은 정의를 나눠 쓴다.
//
// 설계 규칙
//  · SCOPES: 앱마다 담을 localStorage 키 규칙 + IndexedDB 저장소를 선언
//  · 큰 음원(mp3)은 기본으로 담지 않는다 — 원할 때만 켠다(수백 MB가 될 수 있음)
//  · 복원은 "합치기"와 "덮어쓰기"를 사용자가 고른다
// ============================================================================
const BackupCore = (() => {

  // localStorage 키가 어느 앱 것인지 — prefix만으로는 새 키를 놓치기 쉬워
  // (실제로 bible-prayer-texts가 "bible-pray-" 필터에 안 걸려 백업에서 빠져 있었다)
  // 정확한 키 목록과 prefix를 함께 쓴다.
  const SCOPES = {
    reader: {
      label: "성경읽기",
      prefixes: ["bible-reader-"],
      keys: [],
      idb: [{ db: "bible-reader-recordings", store: "recs", folder: "rec" }]
    },
    memorize: {
      label: "성경암송",
      prefixes: ["bible-memory-", "bible-module-"],
      keys: ["bible-user-verses", "bible-user-folders", "bible-favorites",
             "bible-memo-log", "bible-memo-daily", "bible-memo-auto-today",
             "bible-uv-sort", "bible-uv-folder",
             "bible-font", "bible-font-size", "bible-review-dismissed",
             "bible-review-excluded"],
      idb: [
        { db: "bible-user-audio", store: "audio", folder: "audio" },      // 내 목소리 녹음
        { db: "bible-user-images", store: "images", folder: "images" },   // 그림연상 이미지
        { db: "bible-modules", store: "modules", folder: "modules" }      // 설치한 암송 모듈 본문
      ]
    },
    pray: {
      label: "매일기도",
      prefixes: ["bible-pray-"],
      // bible-prayer-texts는 "bible-pray-"로 시작하지 않는다(prayer≠pray-) — 반드시 명시
      keys: ["bible-prayer-texts"],
      idb: []
    },
    praise: {
      label: "매일찬양",
      prefixes: ["bible-praise-", "bible-hymn-"],
      keys: [],
      // mp3 본체는 무거워 기본 제외 — heavy:true 인 것은 옵션을 켰을 때만 담는다
      idb: [
        { db: "bible-praise-audio", store: "files", folder: "praise-audio", heavy: true },
        { db: "bible-hymn-audio", store: "files", folder: "hymn-audio", heavy: true }   // 찬미가 반주 파일
      ]
    },
    share: {
      label: "매일나눔",
      prefixes: ["bible-share-"],
      keys: [],
      idb: []
    },
    hub: {
      label: "공통 설정·첨부",
      prefixes: [],
      keys: ["bible-journal",
             "bible-color-scheme", "bible-suite-font", "bible-suite-scale",
             "bible-user-profile", "bible-hub-cal", "bible-backup-attach", "bible-last-backup"],
      // 첨부파일은 기도·암송 양쪽이 같은 저장소를 쓰므로 공통에 둔다
      idb: [{ db: "bible-attachments", store: "files", folder: "attach" }]
    }
  };

  const ALL_SCOPES = Object.keys(SCOPES);

  function _matches(key, scope) {
    const s = SCOPES[scope]; if (!s) return false;
    if (s.keys.includes(key)) return true;
    return s.prefixes.some(p => key.startsWith(p));
  }

  // 지정한 범위에 속하는 localStorage 전부
  function collectLocal(scopes) {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k) continue;
      if (scopes.some(s => _matches(k, s))) out[k] = localStorage.getItem(k);
    }
    return out;
  }

  // ── IndexedDB 통째 읽기/쓰기 (스토어 구조를 몰라도 되게 getAll 사용) ──
  function _openDB(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => { /* 없는 DB면 빈 채로 열린다 — 그대로 둔다 */ };
    });
  }
  async function _readStore(dbName, storeName) {
    let db;
    try { db = await _openDB(dbName); } catch (e) { return []; }
    if (!db.objectStoreNames.contains(storeName)) { db.close(); return []; }
    return new Promise((resolve) => {
      const req = db.transaction(storeName).objectStore(storeName).getAll();
      req.onsuccess = () => { resolve(req.result || []); db.close(); };
      req.onerror = () => { resolve([]); db.close(); };
    });
  }
  async function _writeStore(dbName, storeName, rows) {
    let db;
    try { db = await _openDB(dbName); } catch (e) { return 0; }
    if (!db.objectStoreNames.contains(storeName)) { db.close(); return 0; }
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, "readwrite");
      const os = tx.objectStore(storeName);
      rows.forEach(r => { try { os.put(r); } catch (e) {} });
      tx.oncomplete = () => { resolve(rows.length); db.close(); };
      tx.onerror = () => { resolve(0); db.close(); };
    });
  }

  // Blob이 섞인 레코드를 zip 파일 + 메타로 분리해 담는다
  async function _writeIdb(zip, spec) {
    const rows = await _readStore(spec.db, spec.store);
    if (!rows.length) return 0;
    const folder = zip.folder(spec.folder);
    const meta = [];
    let n = 0;
    for (const row of rows) {
      const blobKey = Object.keys(row).find(k => row[k] instanceof Blob);
      const id = row.id != null ? String(row.id) : String(n);
      if (blobKey) {
        folder.file(id + ".bin", row[blobKey]);
        const rest = Object.assign({}, row); delete rest[blobKey];
        meta.push({ __id: id, __blobKey: blobKey, rest });
      } else {
        meta.push({ __id: id, __blobKey: null, rest: row });
      }
      n++;
    }
    folder.file("_meta.json", JSON.stringify(meta));
    return n;
  }
  async function _readIdb(zip, spec) {
    const folder = zip.folder(spec.folder);
    const metaFile = folder.file("_meta.json");
    if (!metaFile) return 0;
    let meta;
    try { meta = JSON.parse(await metaFile.async("string")); } catch (e) { return 0; }
    const rows = [];
    for (const m of meta) {
      const row = Object.assign({}, m.rest);
      if (m.__blobKey) {
        const f = folder.file(m.__id + ".bin");
        if (f) row[m.__blobKey] = await f.async("blob");
      }
      rows.push(row);
    }
    return _writeStore(spec.db, spec.store, rows);
  }

  // ── 백업 만들기 ───────────────────────────────────────────────────
  //  scopes: ["pray"] 처럼 일부만, 또는 ALL_SCOPES 로 전체
  //  includeHeavy: 큰 음원(mp3)까지 담을지
  async function create(scopes, { includeHeavy = false } = {}) {
    if (typeof JSZip === "undefined") throw new Error("백업 도구(JSZip)를 불러오지 못했습니다");
    const zip = new JSZip();
    const local = collectLocal(scopes);
    const counts = {};
    for (const s of scopes) {
      for (const spec of (SCOPES[s].idb || [])) {
        if (spec.heavy && !includeHeavy) continue;
        counts[spec.folder] = await _writeIdb(zip, spec);
      }
    }
    zip.file("backup.json", JSON.stringify({
      app: "항상예수께로", format: 2, scopes, includeHeavy,
      exportedAt: Date.now(), local, counts
    }, null, 0));
    return zip;
  }

  // 백업 파일을 **어디에 두었는지 사람이 알 수 있게** 저장한다.
  //
  // 예전에는 <a download> 하나로 끝냈다. 그런데 안드로이드 앱(Capacitor WebView)은
  // 그 클릭을 받아 줄 다운로드 처리기가 없어 **아무 일도 일어나지 않는다** — 그런데도
  // 화면에는 "✓ 백업 완료" 가 떴다. 백업이 없는데 있다고 믿는 것이 가장 나쁘다.
  //
  // 그래서 기기마다 확실한 길로 간다. 어디로 갔는지는 **부르는 쪽에 돌려주어**
  // 사람에게 그대로 보인다.
  //   · 안드로이드 앱  → 문서 폴더에 직접 쓰고, 원하면 바로 내보내기
  //   · PC 크롬·엣지   → 저장 위치를 사용자가 고른다(고른 자리라 못 찾을 일이 없다)
  //   · 그 밖(사파리)  → 다운로드 폴더
  const _blobToB64 = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1]);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });

  async function download(zip, filename) {
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });

    // ① 안드로이드 앱 — 문서 폴더에 직접 쓴다
    const Cap = window.Capacitor;
    const FS = Cap && Cap.Plugins && Cap.Plugins.Filesystem;
    if (FS && Cap.isNativePlatform && Cap.isNativePlatform()) {
      try {
        await FS.writeFile({ path: filename, data: await _blobToB64(blob), directory: "DOCUMENTS", recursive: true });
        let uri = "";
        try { uri = (await FS.getUri({ path: filename, directory: "DOCUMENTS" })).uri || ""; } catch (e) {}
        return { where: "app", label: "이 기기의 문서 폴더", filename, uri, blob };
      } catch (e) { /* 아래 길로 내려간다 — 백업을 못 만드는 것보다 낫다 */ }
    }

    // ② PC 크롬·엣지 — 사용자가 자리를 고른다
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const h = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "백업 압축파일", accept: { "application/zip": [".zip"] } }]
        });
        const w = await h.createWritable();
        await w.write(blob); await w.close();
        return { where: "picked", label: "고르신 자리", filename: h.name || filename, blob };
      } catch (e) {
        if (e && e.name === "AbortError") return { where: "cancel", filename, blob };   // 사용자가 그만둠
        /* 그 밖의 탈은 아래 길로 */
      }
    }

    // ③ 그 밖 — 다운로드 폴더
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
    return { where: "download", label: "다운로드 폴더", filename, blob };
  }

  // 만든 백업을 다른 앱으로 내보낸다(카카오톡·드라이브·에어드롭 등).
  // 안드로이드 앱에서 문서 폴더를 못 찾겠다는 분을 위한 두 번째 길이다.
  async function shareBackup(saved) {
    const Cap = window.Capacitor;
    const SH = Cap && Cap.Plugins && Cap.Plugins.Share;
    const FS = Cap && Cap.Plugins && Cap.Plugins.Filesystem;
    if (SH && FS && saved && saved.uri) {
      await SH.share({ title: saved.filename, url: saved.uri });
      return true;
    }
    // 웹에서는 브라우저의 공유를 쓴다 — 되는 기기에서만
    if (navigator.canShare && saved && saved.blob) {
      const f = new File([saved.blob], saved.filename, { type: "application/zip" });
      if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); return true; }
    }
    return false;
  }

  const dateStr = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`; };

  // ── 복원 ─────────────────────────────────────────────────────────
  //  mode: "merge"(합치기, 기본) | "overwrite"(덮어쓰기)
  //   · overwrite: 이 백업이 담당하는 범위의 기존 키를 먼저 지우고 넣는다
  //     (백업에 없는 항목 = 지운 항목이라는 뜻이 되도록)
  //   · merge: 배열·객체는 항목 단위로 합치고, 나머지는 백업 값으로 갱신
  async function restore(file, { mode = "merge" } = {}) {
    if (typeof JSZip === "undefined") throw new Error("복원 도구(JSZip)를 불러오지 못했습니다");
    const zip = await JSZip.loadAsync(file);
    const metaFile = zip.file("backup.json");
    if (!metaFile) throw new Error("이 앱의 백업 파일이 아닙니다");
    const meta = JSON.parse(await metaFile.async("string"));
    const scopes = meta.scopes || ALL_SCOPES;
    const local = meta.local || {};

    if (mode === "overwrite") {
      // 이 백업이 책임지는 범위만 비운다 — 다른 앱 데이터는 건드리지 않는다
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && scopes.some(s => _matches(k, s))) doomed.push(k);
      }
      doomed.forEach(k => localStorage.removeItem(k));
      Object.entries(local).forEach(([k, v]) => localStorage.setItem(k, v));
    } else {
      Object.entries(local).forEach(([k, v]) => _mergeKey(k, v));
    }

    let restored = 0;
    for (const s of scopes) {
      for (const spec of (SCOPES[s].idb || [])) {
        restored += await _readIdb(zip, spec);
      }
    }
    return { scopes, restored, exportedAt: meta.exportedAt, includeHeavy: !!meta.includeHeavy };
  }

  // 합치기 규칙 — id를 가진 배열은 id 기준 합집합, 날짜별 객체는 얕은 병합
  function _mergeKey(key, incomingRaw) {
    const cur = localStorage.getItem(key);
    if (cur == null) { localStorage.setItem(key, incomingRaw); return; }
    let a, b;
    try { a = JSON.parse(cur); b = JSON.parse(incomingRaw); }
    catch (e) { localStorage.setItem(key, incomingRaw); return; }   // 순수 문자열 설정값 등

    if (Array.isArray(a) && Array.isArray(b)) {
      if (b.length && typeof b[0] === "object" && b[0] && "id" in b[0]) {
        const map = new Map(a.filter(x => x && x.id).map(x => [x.id, x]));
        b.forEach(x => { if (x && x.id) map.set(x.id, x); });
        localStorage.setItem(key, JSON.stringify([...map.values()]));
      } else {
        localStorage.setItem(key, JSON.stringify(b));   // 단순 배열은 백업 것으로
      }
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      localStorage.setItem(key, JSON.stringify(Object.assign({}, a, b)));
      return;
    }
    localStorage.setItem(key, incomingRaw);
  }

  // ── 마지막 백업 시각 (허브 리마인더용) ────────────────────────────
  const LAST_KEY = "bible-last-backup";
  function markBackedUp() { try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch (e) {} }
  function lastBackupAt() {
    try { const v = parseInt(localStorage.getItem(LAST_KEY), 10); return isNaN(v) ? null : v; }
    catch (e) { return null; }
  }
  function daysSinceBackup() {
    const t = lastBackupAt();
    if (!t) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  // JSZip을 필요할 때만 불러온다 (모든 페이지가 미리 들고 있을 필요 없음)
  let _zipP = null;
  function ensureJSZip() {
    if (window.JSZip) return Promise.resolve(true);
    if (_zipP) return _zipP;
    _zipP = new Promise((res) => {
      const s = document.createElement("script");
      s.src = "lib/jszip.min.js";
      s.onload = () => res(true); s.onerror = () => res(false);
      document.head.appendChild(s);
    });
    return _zipP;
  }

  return { SCOPES, ALL_SCOPES, collectLocal, create, download, shareBackup, restore,
           dateStr, markBackedUp, lastBackupAt, daysSinceBackup, ensureJSZip };
})();
