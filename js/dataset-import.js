"use strict";
// ─────────────────────────────────────────────────────────────────────
// DatasetImport — `tojesus` 공용 데이터셋을 앱이 알아보게 한다
//
// 「함께 예수께로」와 규칙을 맞춘다(설계: Gospel_Harmony/EGW/tojesus-데이터셋-설계.md).
//
//     tojesus/aBook       오디오북
//     tojesus/Bethlehem   베들레헴 성경 — bdb · cdb · sdb · dct · hdb · cmp
//     tojesus/EGW         화잇 저서 — wdb
//     tojesus/Hymns       찬미가 음원과 **주소록(.json)**
//     tojesus/Music       그 밖의 음원
//
// **폴더 이름이 아니라 파일 속을 보고** 종류를 정한다. 폴더는 사람이 정리하기
// 위한 것이고, 잘못 든 파일이 있어도 앱이 바로잡을 수 있어야 한다.
//
// 분류·보관은 이 한 곳에만 둔다. 화면마다 따로 두면 규칙이 갈라진다.
// ─────────────────────────────────────────────────────────────────────
const DatasetImport = (() => {

  // ── 맥이 남긴 찌꺼기 ────────────────────────────────────────────────
  // 맥에서 압축하면 `__MACOSX/` 아래에 `._이름` 짝이 함께 들어간다(AppleDouble,
  // 첫 네 바이트 00 05 16 07). 이름이 `.mp3`·`.bdb` 로 끝나 진짜처럼 보이므로
  // 안 막으면 앱이 진짜 대신 이것을 집는다 — 삼성 태블릿에서 반주가 안 울린
  // 까닭이 바로 이것이었다(2026-08-28 실측). 실제로 제작자가 보내신
  // tojesus.zip 에도 117개가 들어 있었다.
  function isJunk(path) {
    const p = String(path || "");
    if (!p || p.endsWith("/")) return true;               // 폴더 자체
    if (p.startsWith("__MACOSX/") || p.includes("/__MACOSX/")) return true;
    const leaf = p.split("/").pop();
    return leaf.startsWith("._") || leaf === ".DS_Store" || leaf.startsWith(".");
  }

  // ── 압축파일 안의 한글 이름 되살리기 ────────────────────────────────
  // 맥 파인더로 만든 zip 은 이름을 UTF-8 바이트로 적으면서 **「UTF-8 이다」라는
  // 표시(플래그 0x800)를 켜지 않는다.** 읽는 쪽은 규격대로 옛 코드페이지로
  // 풀어 `찬미가.cmp` 가 알아볼 수 없는 글자가 된다. 실제로 제작자의
  // tojesus.zip 은 234개 항목 전부가 이 상태였다(2026-08-30 실측).
  //
  // 그래서 되읽는다 — 바이트를 되돌린 뒤 UTF-8 로 다시 푼다. UTF-8 이 아니면
  // 원래 이름을 그대로 둔다(진짜 옛 코드페이지 zip 을 망가뜨리지 않는다).
  function fixName(name) {
    let s = String(name || "");
    if (/[\u0080-\u00ff]/.test(s)) {
      try {
        const bytes = new Uint8Array(s.length);
        let flat = true;
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          if (c > 0xff) { flat = false; break; }            // 이미 제대로 풀린 이름
          bytes[i] = c;
        }
        if (flat) s = new TextDecoder("utf-8", { fatal: true }).decode(bytes) || s;
      } catch (e) { /* UTF-8 이 아니었다 — 원래 이름을 그대로 둔다 */ }
    }
    // **자모를 다시 붙인다(NFC).** 맥은 파일 이름의 한글을 자모로 쪼개 적는다
    // (NFD) — `개역한글` 이 8자가 아니라 15자다. 보기에는 똑같아서 눈으로는
    // 못 잡는데, 이름이 열쇠라 그대로 두면 ① 이름으로 찾을 때 못 찾고
    // ② `가-힣` 로 가리는 가나다순 정렬에서 한글이 아닌 것으로 밀리고
    // ③ 같은 파일을 다른 길로 한 번 더 넣으면 두 벌이 된다.
    // 실제로 tojesus.zip 을 넣었더니 성경이 안 열렸다(2026-08-30 실측).
    try { s = s.normalize("NFC"); } catch (e) {}
    return s;
  }

  // ── 압축 풀기 ──────────────────────────────────────────────────────
  const isZip = (f) => !!f && /\.zip$/i.test(f.name || "");

  async function ensureZipLib() {
    if (typeof JSZip !== "undefined") return true;
    if (typeof BackupCore !== "undefined" && BackupCore.ensureJSZip) return !!(await BackupCore.ensureJSZip());
    return false;
  }

  // zip 하나를 풀어 **File 객체 배열**로 돌려준다.
  // File 로 돌려주는 까닭 — 이미 있는 불러오기 길(loadFiles)이 File 을 받으므로
  // 새 길을 내지 않고 그대로 얹을 수 있다.
  async function unzip(file, onProgress) {
    if (!(await ensureZipLib())) throw new Error("압축 도구(JSZip)를 불러오지 못했습니다");
    const zip = await JSZip.loadAsync(file);
    const entries = [];
    zip.forEach((path, e) => { if (!e.dir) entries.push(e); });
    const out = [];
    let done = 0;
    for (const e of entries) {
      done++;
      const path = fixName(e.name);
      if (isJunk(path)) continue;
      if (onProgress) onProgress(done, entries.length, path);
      const blob = await e.async("blob");
      const leaf = path.split("/").pop();
      const when = e.date ? e.date.getTime() : 0;
      const f = new File([blob], leaf, { type: "", lastModified: when });
      try { Object.defineProperty(f, "zipPath", { value: path }); } catch (err) {}
      out.push(f);
    }
    return out;
  }

  // ── 종류 가리기 ────────────────────────────────────────────────────
  // 확장자를 먼저 보되, 확장자를 넘기지 않는 태블릿이 있어 **내용으로도** 본다.
  const DB_EXT = /\.(bdb|sdb|cdb|dct|hdb|cmp|wdb)$/i;
  const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|wav|opus|flac)$/i;

  // 주소록인가 — 곡 번호 → 음원 자리 꼴의 .json.
  // 백업 파일이나 다른 설정 json 을 주소록으로 잘못 삼지 않도록 속을 본다.
  function looksLikePack(data) {
    if (!data || typeof data !== "object") return false;
    if (Array.isArray(data)) {
      return data.some(r => r && (r.hymn_number ?? r.number ?? r.no ?? r.chapter) != null);
    }
    if (!data.items || typeof data.items !== "object") return false;
    const keys = Object.keys(data.items);
    return keys.length > 0 && keys.every(k => /^\d{1,3}$/.test(k));
  }

  // 파일 하나를 훑어 무엇인지만 말한다(저장은 하지 않는다).
  //   "db"    — 성경·주석·원어·사전·찬미가·악보·화잇 저서
  //   "pack"  — 찬미가 음원 주소록(.json)
  //   "audio" — 음원. 앱에 담지 않고 폴더에 둔다
  //   null    — 우리가 다룰 것이 아니다
  async function sniff(file) {
    const n = file && file.name ? file.name : "";
    if (DB_EXT.test(n)) return "db";
    if (AUDIO_EXT.test(n)) return "audio";
    if (/\.json$/i.test(n)) {
      try { return looksLikePack(JSON.parse(await file.text())) ? "pack" : null; }
      catch (e) { return null; }
    }
    // 확장자가 없는 파일 — 앞머리만 읽어 SQLite 인지 본다
    try {
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const magic = String.fromCharCode(...head.slice(0, 15));
      if (magic === "SQLite format 3") return "db";
      if (head[0] === 0x50 && head[1] === 0x4B) return "db";   // ZIP — 악보(.cmp)일 수 있다
    } catch (e) {}
    return null;
  }

  // ── 주소록 넣기 ────────────────────────────────────────────────────
  async function addPack(file) {
    if (typeof HymnSource === "undefined") return { ok: false, error: "찬양 모듈 없음" };
    const data = JSON.parse(await file.text());
    const pack = HymnSource.parsePack(data, file.name.replace(/\.json$/i, ""));
    if (!HymnSource.adapter(pack.kind)) return { ok: false, error: "모르는 음원 종류: " + pack.kind };
    // 같은 이름이 이미 있으면 갈아 끼운다 — 재인식을 눌러도 목록이 불어나지 않게
    const same = (HymnSource.packs() || []).filter(p => p.name === pack.name);
    same.forEach(p => HymnSource.removePack(p.id));
    HymnSource.addPack(pack);
    return { ok: true, name: pack.name, count: Object.keys(pack.items || {}).length };
  }

  // ── 자료 파일 하나를 보관하기 ──────────────────────────────────────
  // 예전에는 이 판정이 reader.html 안에만 있었다. 전체 설정에서도 같은 일을
  // 해야 하므로 여기로 옮겼다 — 두 벌로 두면 규칙이 갈라진다.
  let _sqlP = null;
  function initSql() {
    if (!_sqlP) _sqlP = initSqlJs({ locateFile: f => "lib/sqljs/" + f });
    return _sqlP;
  }
  const LS_MTIME = "bible-bdb-mtime";
  const loadMtimes = () => { try { return JSON.parse(localStorage.getItem(LS_MTIME) || "{}"); } catch (e) { return {}; } };
  const saveMtimes = (m) => { try { localStorage.setItem(LS_MTIME, JSON.stringify(m)); } catch (e) {} };
  const recordMtime = (id, mtime) => { const m = loadMtimes(); m[id] = mtime || 0; saveMtimes(m); };
  // 같은 이름이 이미 있으면 **더 새것일 때만** 갈아 끼운다. 그래서 재인식을
  // 몇 번 눌러도 탈이 없고, 두 번째부터는 건너뛰어 빠르다.
  async function isOlderDuplicate(id, mtime) {
    if (!mtime) return false;                        // 날짜를 모르면 받아들인다
    const prev = loadMtimes()[id];
    if (!prev || mtime > prev) return false;
    return await BdbStore.has(id);
  }
  const PREFIX = { dct: "dct:", hym: "hym:", cmt: "cmt:", org: "org:", bdb: "bdb:", egw: "egw:" };

  async function storeDb(file) {
    let ext = (file.name.match(DB_EXT) || [, ""])[1].toLowerCase();
    const buf = await file.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const zipMagic = u8[0] === 0x50 && u8[1] === 0x4B;                  // "PK" = ZIP(.cmp)
    const sqlMagic = String.fromCharCode(...u8.slice(0, 15)) === "SQLite format 3";
    // 확장자를 안 넘기는 태블릿이 있다 — 내용으로 메운다
    if (!ext && zipMagic) ext = "cmp";
    else if (!ext && sqlMagic) ext = "bdb";                             // 세부는 아래 표 검사로
    if (!ext) return { ok: false, name: file.name, error: "미지원" };
    const name = file.name.replace(DB_EXT, "");
    const mtime = file.lastModified || 0;

    if (ext === "cmp") {                                                // 찬미가 악보(ZIP)
      if (!zipMagic) return { ok: false, name, error: "ZIP 아님" };
      const id = "hymimg:" + name;
      if (await isOlderDuplicate(id, mtime)) return { ok: false, name, older: true };
      await BdbStore.save(id, name, buf); recordMtime(id, mtime);
      return { ok: true, name, kind: "hymimg", id };
    }

    const SQL = await initSql();
    let db;
    try { db = new SQL.Database(new Uint8Array(buf)); } catch (e) { return { ok: false, name, error: "SQLite 아님" }; }
    const hasTable = (tb) => {
      try { return db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND lower(name)='${tb}' LIMIT 1`).length > 0; }
      catch (e) { return false; }
    };
    let kind;
    if (ext === "dct" || hasTable("lexicon")) kind = "dct";
    else if (ext === "hdb" || hasTable("hymnal")) kind = "hym";
    else if (ext === "wdb" || hasTable("egw")) {                        // 화잇 저서 — 성경 표가 없다
      if (!hasTable("egw")) { db.close(); return { ok: false, name, error: "화잇 저서 형식 아님" }; }
      kind = "egw";
    } else {
      let fine = false;
      try {
        const r = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND lower(name)='bible' LIMIT 1");
        const tb = (r.length && r[0].values.length) ? r[0].values[0][0] : "Bible";
        fine = db.exec(`SELECT book,chapter,verse,btext FROM "${tb}" LIMIT 1`).length > 0;
      } catch (e) { fine = false; }
      if (!fine) { db.close(); return { ok: false, name, error: "미지원 형식" }; }
      kind = (ext === "cdb") ? "cmt" : (ext === "sdb") ? "org" : "bdb";
    }
    db.close();
    const id = PREFIX[kind] + name;
    if (await isOlderDuplicate(id, mtime)) return { ok: false, name, older: true };
    await BdbStore.save(id, name, buf); recordMtime(id, mtime);
    return { ok: true, name, kind, id };
  }

  // ── 여럿을 한꺼번에 ────────────────────────────────────────────────
  // zip 이 섞여 있으면 먼저 푼다. 결과는 종류별로 세어 돌려준다.
  async function run(files, opt) {
    const o = opt || {};
    const say = o.onStatus || (() => {});
    let list = [];
    for (const f of [...(files || [])]) {
      if (isZip(f)) {
        say(`«${f.name}» 푸는 중…`);
        list = list.concat(await unzip(f, (i, n) => say(`푸는 중… ${i}/${n}`)));
      } else if (!isJunk(f.zipPath || f.name)) list.push(f);
    }
    const res = { db: 0, packs: [], audio: 0, older: 0, skip: 0, kinds: new Set(), quota: false, ids: [] };
    let i = 0;
    for (const f of list) {
      i++;
      say(`살펴보는 중… ${i}/${list.length} — ${f.name}`);
      let what;
      try { what = await sniff(f); } catch (e) { what = null; }
      if (what === "audio") { res.audio++; continue; }        // 폴더에 두는 것 — 담지 않는다
      if (what === "pack") {
        try {
          const r = await addPack(f);
          if (r.ok) res.packs.push(r); else res.skip++;
        } catch (e) { res.skip++; }
        continue;
      }
      if (what !== "db") { res.skip++; continue; }
      try {
        const r = await storeDb(f);
        if (r.ok) {
          res.db++; res.kinds.add(r.kind); res.ids.push(r.id);
          // 화면마다 들인 뒤 할 일이 다르다(어느 역본을 지금 볼지 등).
          // 그 뒷일은 부르는 쪽이 맡는다 — 보관 규칙만 여기서 쥔다.
          if (o.onStored) { try { await o.onStored(r); } catch (e) {} }
        }
        else if (r.older) res.older++;
        else res.skip++;
      } catch (e) {
        res.skip++;
        if (/quota|exceeded|space/i.test(String(e && (e.name + e.message)))) res.quota = true;
      }
    }
    return res;
  }

  // ── 폴더에 풀어 넣기 ───────────────────────────────────────────────
  // 압축파일을 **기기의 폴더에** 그대로 풀어 둔다. 앱 안에 담는 것과는 다른 일이다.
  //   · 자료(성경·화잇)는 앱 안에 담아야 읽는다 → run()
  //   · 음원은 너무 커서 담을 수 없다. 폴더에 두고 그 자리에서 읽는다 → 이 함수
  // 그래서 음원까지 갖추려면 이 길이 있어야 한다.
  //
  // 정해진 경로에 앱이 마음대로 쓸 수는 없다(어느 기기든 보안 경계다). 대신
  // **한 번 자리를 정하면 그 아래는 자유**다 — 폴더를 만들고 파일을 쓴다.
  //   · 안드로이드 앱 — 문서(Documents) 폴더. 다른 앱에서도 보이는 자리다.
  //     이 앱이 첨부파일 복사에 이미 쓰고 있는 길이라 자바를 새로 짤 것이 없다.
  //   · PC 크롬·엣지 — 사용자가 자리를 고른다. 고른 것은 기억해 다시 묻지 않는다.
  //   · 아이폰·아이패드 — 되지 않는다. 앱 안으로 담는 길(run)만 쓴다.
  const capFS = () => {
    const C = window.Capacitor;
    return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Filesystem) || null;
  };
  const canPickDir = () => typeof window.showDirectoryPicker === "function";
  const canExtract = () => !!capFS() || canPickDir();

  // 고른 폴더를 기억해 둔다 — 두 번째부터는 묻지 않는다
  const DIR_DB = "tojesus-dir", DIR_STORE = "h";
  function _dirTx(mode, fn) {
    return new Promise((res, rej) => {
      const q = indexedDB.open(DIR_DB, 1);
      q.onupgradeneeded = () => q.result.createObjectStore(DIR_STORE);
      q.onerror = () => rej(q.error);
      q.onsuccess = () => {
        const tx = q.result.transaction(DIR_STORE, mode);
        const r = fn(tx.objectStore(DIR_STORE));
        tx.oncomplete = () => res(r && r.result);
        tx.onerror = () => rej(tx.error);
      };
    });
  }
  async function _rootDir(forceNew) {
    let h = forceNew ? null : await _dirTx("readonly", os => os.get("dir")).catch(() => null);
    if (h) {
      const p = await h.queryPermission({ mode: "readwrite" });
      if (p !== "granted" && (await h.requestPermission({ mode: "readwrite" })) !== "granted") h = null;
    }
    if (!h) {
      h = await window.showDirectoryPicker({ mode: "readwrite" });
      await _dirTx("readwrite", os => os.put(h, "dir"));
    }
    return h;
  }
  const _b64 = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(",")[1]);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });

  // 압축파일 하나를 폴더에 푼다. 안에 `tojesus/` 가 없으면 씌워 준다 —
  // 두 앱이 같은 자리를 보기로 한 약속이다.
  async function extractToFolder(file, opt) {
    const o = opt || {};
    const say = o.onStatus || (() => {});
    if (!(await ensureZipLib())) throw new Error("압축 도구(JSZip)를 불러오지 못했습니다");
    const FS = capFS();
    if (!o.root && !FS && !canPickDir()) throw new Error("이 기기에서는 폴더에 풀 수 없습니다");

    const zip = await JSZip.loadAsync(file);
    const entries = [];
    zip.forEach((path, e) => { if (!e.dir) entries.push(e); });

    let root = o.root || null, dest;
    if (root) dest = (root.name || "고른") + " 폴더";
    else if (FS) dest = "문서(Documents) 폴더";
    else { say("풀어 놓을 자리를 골라 주세요…"); root = await _rootDir(!!o.forceNewDir); dest = root.name + " 폴더"; }

    const dirCache = new Map();
    async function dirFor(parts) {                   // 웹 — 하위 폴더를 만들어 가며 내려간다
      let cur = root, key = "";
      for (const seg of parts) {
        key += "/" + seg;
        let next = dirCache.get(key);
        if (!next) { next = await cur.getDirectoryHandle(seg, { create: true }); dirCache.set(key, next); }
        cur = next;
      }
      return cur;
    }

    let done = 0, wrote = 0, same = 0, failed = 0;
    for (const e of entries) {
      done++;
      let rel = fixName(e.name);
      if (isJunk(rel)) continue;
      if (!/^tojesus\//.test(rel)) rel = "tojesus/" + rel.replace(/^\/+/, "");
      const parts = rel.split("/");
      const leaf = parts.pop();
      say(`${done}/${entries.length} — ${leaf}`);
      try {
        // 같은 크기가 이미 있으면 건너뛴다 — 다시 눌러도 빠르다.
        // 크기는 압축 목록에 적혀 있으므로 **풀기 전에** 견준다. 풀어서 견주면
        // 두 번째에도 첫 번째만큼 걸린다(101개에 14초 실측).
        const want = (e._data && e._data.uncompressedSize) || null;
        let dir = null;
        if (FS && !o.root) {
          try {
            const st = await FS.stat({ path: rel, directory: "DOCUMENTS" });
            if (st && want != null && Number(st.size) === want) { same++; continue; }
          } catch (err) { /* 없으면 그냥 쓴다 */ }
        } else {
          dir = await dirFor(parts);
          try {
            const old = await (await dir.getFileHandle(leaf)).getFile();
            if (want != null && old.size === want) { same++; continue; }
          } catch (err) { /* 없으면 그냥 쓴다 */ }
        }
        const blob = await e.async("blob");
        if (FS && !o.root) {
          await FS.writeFile({ path: rel, data: await _b64(blob), directory: "DOCUMENTS", recursive: true });
        } else {
          const fh = await dir.getFileHandle(leaf, { create: true });
          const w = await fh.createWritable();
          await w.write(blob); await w.close();
        }
        wrote++;
      } catch (err) { failed++; }
    }
    return { dest, wrote, same, failed, total: entries.length };
  }

  // 사람에게 읽어 줄 한 줄
  function summarize(res) {
    const bits = [];
    if (res.db) bits.push(`자료 ${res.db}개`);
    if (res.packs.length) bits.push(`주소록 ${res.packs.length}개(${res.packs.reduce((a, p) => a + p.count, 0)}곡)`);
    if (res.audio) bits.push(`음원 ${res.audio}개는 폴더에 그대로 둠`);
    if (res.older) bits.push(`${res.older}개는 이미 최신`);
    if (res.skip) bits.push(`${res.skip}개 제외`);
    if (!bits.length) return "새로 들일 것이 없었습니다";
    return (res.db || res.packs.length ? "✓ " : "") + bits.join(" · ");
  }

  return { isJunk, fixName, isZip, unzip, sniff, looksLikePack, addPack,
           storeDb, run, summarize, initSql, DB_EXT, AUDIO_EXT,
           canExtract, extractToFolder };
})();
if (typeof module !== "undefined" && module.exports) module.exports = DatasetImport;
