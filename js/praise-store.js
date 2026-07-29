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

  // 기본 분류·채널 + 사용자가 추가한 것 (bible-praise-custom)
  const BASE_CATEGORIES = ["찬미가", "찬송가", "복음성가", "연주찬양", "묵상찬양", "자연의소리"];
  const K_CUSTOM = "bible-praise-custom";
  function custom() {
    const c = _load(K_CUSTOM, {});
    return { cats: Array.isArray(c.cats) ? c.cats : [], chans: Array.isArray(c.chans) ? c.chans : [] };
  }
  function saveCustom(c) { _save(K_CUSTOM, c); }
  // '기타'는 늘 마지막 — 새 분류는 그 앞에 들어간다
  function allCategories() { return [...BASE_CATEGORIES, ...custom().cats, "기타"]; }
  function addCategory(name) {
    const t = String(name || "").trim();
    if (!t) return { ok: false, msg: "이름을 입력해 주세요" };
    if (allCategories().includes(t)) return { ok: false, msg: "이미 있는 분류입니다" };
    const c = custom(); c.cats.push(t); saveCustom(c);
    return { ok: true };
  }
  function removeCategory(name) {
    const c = custom();
    if (!c.cats.includes(name)) return false;      // 기본 분류는 지울 수 없다
    c.cats = c.cats.filter(x => x !== name); saveCustom(c);
    const arr = items().map(x => x.category === name ? Object.assign({}, x, { category: "기타" }) : x);
    saveItems(arr);
    return true;
  }
  function addChannel(name, icon) {
    const t = String(name || "").trim();
    if (!t) return { ok: false, msg: "이름을 입력해 주세요" };
    if (allChannels().some(c => c.key === t)) return { ok: false, msg: "이미 있는 채널입니다" };
    const c = custom(); c.chans.push({ key: t, name: `${icon || "🎵"} ${t}` }); saveCustom(c);
    return { ok: true };
  }
  function removeChannel(key) {
    const c = custom();
    if (!c.chans.some(x => x.key === key)) return false;   // 기본 채널은 지울 수 없다
    c.chans = c.chans.filter(x => x.key !== key); saveCustom(c);
    return true;                                            // 곡의 태그는 그대로 둔다(태그로 듣기에 남음)
  }
  // ── 채널: 태그로 모으는 재생 묶음 (간이 뮤직플레이어) ──────────────────
  //  · 곡의 태그에 채널 키워드가 있으면 그 채널에 속한다
  //  · 폴더째 담기 때 폴더 이름(예: "기도찬양")도 자동으로 태그가 된다
  const BASE_CHANNELS = [
    { key: "새벽", name: "🌅 새벽찬양" },
    { key: "기도", name: "🙏 기도찬양" },
    { key: "밝은", name: "☀️ 밝은찬양" },
    { key: "맑은", name: "💧 맑은찬양" },
    { key: "저녁", name: "🌙 저녁찬양" },
    { key: "천연계", name: "🌿 천연계", extraCat: "자연의소리" }
  ];
  function allChannels() { return [...BASE_CHANNELS, ...custom().chans]; }
  // 채널에 속한 곡 (태그 일치, 천연계는 '자연의소리' 분류도 포함)
  function channelSongs(chKey) {
    const ch = allChannels().find(c => c.key === chKey);
    return items().filter(x =>
      (x.tags || []).some(t => t.includes(chKey)) ||
      (ch && ch.extraCat && x.category === ch.extraCat));
  }
  const inChannel = (item, chKey) => (item.tags || []).some(t => t.includes(chKey));
  // 곡을 채널에 넣고 빼기 — 채널 소속은 태그로 표현되므로 태그를 더하고 지운다
  function toggleChannel(id, chKey) {
    const arr = items();
    const i = arr.findIndex(x => x.id === id);
    if (i < 0) return false;
    const tags = arr[i].tags || [];
    const has = inChannel(arr[i], chKey);
    const next = has ? tags.filter(t => !t.includes(chKey)) : tags.concat(chKey);
    arr[i] = Object.assign({}, arr[i], { tags: next, updatedAt: Date.now() });
    saveItems(arr);
    return !has;
  }
  // 채널·분류에 쓰이지 않는 사용자 태그 모음 (태그로 듣기 카드용)
  function userTags() {
    const chans = allChannels();
    const skip = new Set(chans.map(c => c.key));
    const count = {};
    for (const it of items()) for (const t of (it.tags || [])) {
      if (!t || skip.has(t) || chans.some(c => t.includes(c.key))) continue;
      count[t] = (count[t] || 0) + 1;
    }
    return Object.entries(count).filter(([, n]) => n >= 2)      // 2곡 이상 묶인 태그만 카드로
      .sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ tag: t, n }));
  }
  const tagSongs = (tag) => items().filter(x => (x.tags || []).includes(tag));
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
      category: allCategories().includes(data.category) ? data.category : "기타",
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

  // keepAudio=true면 목록 항목만 지우고 음원(IndexedDB)은 남긴다
  function remove(id, keepAudio) {
    saveItems(items().filter(x => x.id !== id));
    // 예약·기록에서도 정리 (기록은 남겨도 무방하나 깨진 참조 방지)
    const plan = _load(K_PLAN, {});
    for (const d in plan) { plan[d] = plan[d].filter(x => x !== id); if (!plan[d].length) delete plan[d]; }
    _save(K_PLAN, plan);
    return keepAudio ? Promise.resolve() : PraiseAudio.remove(id).catch(() => {});
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

  return { get CATEGORIES() { return allCategories(); }, LANGS,
           get CHANNELS() { return allChannels(); },
           BASE_CATEGORIES, BASE_CHANNELS, custom,
           addCategory, removeCategory, addChannel, removeChannel,
           channelSongs, inChannel, toggleChannel, userTags, tagSongs,
           today, tomorrow, items, saveItems, add, update, remove,
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
      tx.oncomplete = () => resolve(out && typeof out === "object" && "result" in out ? out.result : out);   // 조회 미스는 undefined로 (요청 객체가 새어 나가 truthy 오판되던 버그 수정)
      tx.onerror = () => reject(tx.error);
    }));
  }

  const save = (id, blob) => _tx("readwrite", os => os.put({ id, blob, mime: blob.type || "audio/mpeg", size: blob.size }));
  const get = (id) => _tx("readonly", os => os.get(id));
  const remove = (id) => _tx("readwrite", os => os.delete(id));
  async function getURL(id) { const rec = await get(id); return rec && rec.blob ? URL.createObjectURL(rec.blob) : null; }

  return { save, get, getURL, remove };
})();
