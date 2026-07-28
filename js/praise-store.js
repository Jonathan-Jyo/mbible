// ============================================================================
// PraiseStore — 매일찬양 데이터
// ----------------------------------------------------------------------------
// · 메타(제목·분류·작곡자·가사·태그 등): localStorage  bible-praise-items
// · mp3 음원(대용량): IndexedDB  bible-praise-audio   → 오프라인 재생
// · 새벽예약: bible-praise-plan  { "YYYY-MM-DD": [id,…] }  (전날 밤에 담는 큐)
// · 들은기록: bible-praise-log   { "YYYY-MM-DD": [id,…] }  (달력·종합달력 재료)
// ============================================================================

const PraiseStore = (() => {
  const K_ITEMS = "bible-praise-items";
  const K_PLAN  = "bible-praise-plan";
  const K_LOG   = "bible-praise-log";

  const CATEGORIES = ["찬미가", "찬송가", "복음성가", "연주찬양", "묵상찬양", "자연의소리", "기타"];
  const LANGS = ["한글", "외국어"];

  const _load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  const _save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const _id = () => `ps-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // 로컬 기준 날짜 — toISOString(UTC)은 한국 새벽(0~9시)에 하루 전 날짜가 되므로 금지
  const _localDay = (d) => { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const today = () => _localDay(new Date());
  const tomorrow = () => _localDay(new Date(Date.now() + 86400000));

  // ── 항목 ──────────────────────────────────────────────────────────────
  function items() { return _load(K_ITEMS, []); }
  function saveItems(arr) { _save(K_ITEMS, arr); }

  function add(data) {
    const item = {
      id: _id(),
      title:    data.title || "",
      category: CATEGORIES.includes(data.category) ? data.category : "기타",
      lang:     LANGS.includes(data.lang) ? data.lang : "한글",
      composer: data.composer || "",     // 작곡자
      lyricist: data.lyricist || "",     // 작사자
      performer: data.performer || "",   // 연주자
      verseRef: data.verseRef || "",     // 주제성경절
      youtube:  data.youtube || "",      // 유튜브 링크 (mp3와 병행 가능)
      hasAudio: !!data.hasAudio,         // mp3 보유 여부 (음원은 IndexedDB)
      lyrics:   data.lyrics || "",
      tags:     Array.isArray(data.tags) ? data.tags : [],
      favorite: false,
      memorized: false,                  // 가사 암송 완료 표시
      createdAt: Date.now(), updatedAt: Date.now()
    };
    const arr = items(); arr.push(item); saveItems(arr);
    return item;
  }

  function update(id, patch) {
    const arr = items();
    const i = arr.findIndex(x => x.id === id);
    if (i < 0) return null;
    arr[i] = Object.assign({}, arr[i], patch, { updatedAt: Date.now() });
    saveItems(arr);
    return arr[i];
  }

  function remove(id) {
    saveItems(items().filter(x => x.id !== id));
    // 예약·기록에서도 정리 (기록은 남겨도 무방하나 깨진 참조 방지)
    const plan = _load(K_PLAN, {});
    for (const d in plan) { plan[d] = plan[d].filter(x => x !== id); if (!plan[d].length) delete plan[d]; }
    _save(K_PLAN, plan);
    return PraiseAudio.remove(id).catch(() => {});
  }

  // 유튜브 URL → 영상 ID (watch·youtu.be·shorts·embed 형태 지원)
  function youtubeId(url) {
    const m = String(url || "").match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  // ── 새벽예약 (큐) ─────────────────────────────────────────────────────
  function plan() { return _load(K_PLAN, {}); }
  function planFor(date) { return plan()[date] || []; }
  function togglePlan(date, id) {
    const p = plan();
    const list = p[date] || [];
    const has = list.includes(id);
    const next = has ? list.filter(x => x !== id) : list.concat(id);
    if (next.length) p[date] = next; else delete p[date];
    _save(K_PLAN, p);
    return !has;
  }

  // ── 들은기록 ──────────────────────────────────────────────────────────
  function log() { return _load(K_LOG, {}); }
  function logListen(id) {
    const l = log();
    const d = today();
    const list = l[d] || [];
    if (!list.includes(id)) { l[d] = list.concat(id); _save(K_LOG, l); }
  }

  return { CATEGORIES, LANGS, today, tomorrow, items, saveItems, add, update, remove,
           youtubeId, plan, planFor, togglePlan, log, logListen };
})();

// ============================================================================
// PraiseAudio — mp3 음원 (IndexedDB). 키 = 찬양 id
// ============================================================================
const PraiseAudio = (() => {
  const DB = "bible-praise-audio", STORE = "files";

  function _db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function _tx(mode, fn) {
    return _db().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      tx.onerror = () => reject(tx.error);
    }));
  }

  const save = (id, blob) => _tx("readwrite", os => os.put({ id, blob, mime: blob.type || "audio/mpeg", size: blob.size }));
  const get = (id) => _tx("readonly", os => os.get(id));
  const remove = (id) => _tx("readwrite", os => os.delete(id));
  async function getURL(id) { const rec = await get(id); return rec && rec.blob ? URL.createObjectURL(rec.blob) : null; }

  return { save, get, getURL, remove };
})();
