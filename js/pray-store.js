// ============================================================================
// PrayStore — 매일기도 데이터 (localStorage) + 비밀기도 암호화 (WebCrypto)
// ----------------------------------------------------------------------------
// · 기도제목/기도기록/감사노트는 텍스트라 localStorage로 충분 (수년치 ≒ 수 MB)
// · 🔒 비밀 기도제목: 제목·내용을 AES-GCM으로 암호화해 저장
//   - PIN은 어디에도 저장하지 않고 PBKDF2로 키만 유도 (PIN 분실 시 복구 불가)
//   - 대상·상태·시간대는 평문 유지 → 잠긴 상태에서도 목록·통계는 동작
// · pray.html과 reader.html(절→기도제목 보내기)이 함께 사용
// ============================================================================

const PrayStore = (() => {
  const K_ITEMS  = "bible-pray-items";
  const K_LOG    = "bible-pray-log";
  const K_THANKS = "bible-pray-thanks";

  const TARGETS = ["개인", "가족", "이웃", "교인", "구도자", "공동체", "세계선교"];
  const TYPES   = ["간구", "회개", "도고", "감사", "찬양"];
  const SLOTS   = [["dawn", "새벽"], ["noon", "점심"], ["eve", "저녁"]];
  const STATUS  = [["open", "기도중"], ["answered", "응답됨"], ["waiting", "기다림"], ["closed", "마침"]];

  function _load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function _save(key, v) { localStorage.setItem(key, JSON.stringify(v)); }
  function _id(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }
  function today() { return new Date().toISOString().slice(0, 10); }

  // ── 기도제목 ──────────────────────────────────────────────────────────
  function items() { return _load(K_ITEMS, []); }
  function saveItems(arr) { _save(K_ITEMS, arr); }

  function add(data) {
    const item = {
      id: _id("pr"),
      target:  TARGETS.includes(data.target) ? data.target : "개인",
      type:    TYPES.includes(data.type) ? data.type : "간구",
      title:   data.title || "",
      content: data.content || "",
      promiseRef:  data.promiseRef  || "",   // 약속말씀 장절 (예: "요 15:7 (개역한글)")
      promiseText: data.promiseText || "",   // 약속말씀 본문
      slots:   Array.isArray(data.slots) && data.slots.length ? data.slots : ["dawn"],
      status:  "open",
      start:   data.start || today(),
      answeredAt: null,
      answer:  "",
      secret:  false,          // 암호화는 setSecret()을 통해서만 켠다
      enc:     null,           // 암호문 (secret일 때 title/content 대신)
      createdAt: Date.now(),
      updatedAt: Date.now()
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

  function remove(id) { saveItems(items().filter(x => x.id !== id)); }

  function markAnswered(id, answer) {
    return update(id, { status: "answered", answeredAt: today(), answer: answer || "" });
  }

  // ── 기도기록 (달력의 재료) ────────────────────────────────────────────
  //  { "2026-07-28": { dawn:[id,…], noon:[…], eve:[…] } }
  function log() { return _load(K_LOG, {}); }

  function toggleLog(date, slot, id) {
    const l = log();
    const day = l[date] || {};
    const list = day[slot] || [];
    const has = list.includes(id);
    const next = has ? list.filter(x => x !== id) : list.concat(id);
    const nextDay = Object.assign({}, day, { [slot]: next });
    if (!next.length) delete nextDay[slot];
    if (Object.keys(nextDay).length) l[date] = nextDay; else delete l[date];
    _save(K_LOG, l);
    return !has;
  }

  function loggedToday(slot, id) {
    const day = log()[today()] || {};
    return (day[slot] || []).includes(id);
  }

  // ── 감사노트 ──────────────────────────────────────────────────────────
  function thanks() { return _load(K_THANKS, []); }
  function addThanks(text) {
    const arr = thanks();
    arr.push({ id: _id("th"), date: today(), text: String(text || "").trim(), createdAt: Date.now() });
    _save(K_THANKS, arr);
    return arr[arr.length - 1];
  }
  function removeThanks(id) { _save(K_THANKS, thanks().filter(x => x.id !== id)); }

  return {
    TARGETS, TYPES, SLOTS, STATUS, today,
    items, saveItems, add, update, remove, markAnswered,
    log, toggleLog, loggedToday,
    thanks, addThanks, removeThanks
  };
})();

// ============================================================================
// PrayCrypt — PIN 기반 암호화 (AES-GCM 256 + PBKDF2 15만회)
// ============================================================================
const PrayCrypt = (() => {
  const K_META = "bible-pray-crypt";      // { salt, iter, check } — PIN 자체는 저장 안 함
  const CHECK_PLAIN = "pray-ok";
  let _key = null;                        // 세션 동안만 메모리에 유지

  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function _derive(pin, saltB64, iter) {
    const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: unb64(saltB64), iterations: iter, hash: "SHA-256" },
      raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  }

  async function _enc(key, plain) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
    const out = new Uint8Array(iv.length + ct.byteLength);
    out.set(iv); out.set(new Uint8Array(ct), iv.length);
    return b64(out.buffer);
  }

  async function _dec(key, packed) {
    const buf = unb64(packed);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
    return new TextDecoder().decode(pt);
  }

  function meta() { try { return JSON.parse(localStorage.getItem(K_META) || "null"); } catch (e) { return null; } }
  function isSetup() { return !!meta(); }
  function isUnlocked() { return !!_key; }
  function lock() { _key = null; }

  async function setup(pin) {
    if (isSetup()) throw new Error("이미 PIN이 설정되어 있습니다.");
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
    const iter = 150000;
    const key = await _derive(pin, salt, iter);
    const check = await _enc(key, CHECK_PLAIN);
    localStorage.setItem(K_META, JSON.stringify({ salt, iter, check }));
    _key = key;
  }

  async function unlock(pin) {
    const m = meta();
    if (!m) throw new Error("PIN이 아직 설정되지 않았습니다.");
    const key = await _derive(pin, m.salt, m.iter);
    try { if (await _dec(key, m.check) !== CHECK_PLAIN) throw 0; }
    catch (e) { throw new Error("PIN이 일치하지 않습니다."); }
    _key = key;
  }

  // 항목의 제목·내용을 암호문으로 교체 / 복원 (PrayStore와 짝)
  async function encryptItem(item) {
    if (!_key) throw new Error("잠금 해제가 필요합니다.");
    const enc = await _enc(_key, JSON.stringify({ title: item.title, content: item.content, answer: item.answer || "" }));
    return Object.assign({}, item, { secret: true, enc, title: "", content: "", answer: "" });
  }

  async function decryptItem(item) {
    if (!item.secret || !item.enc) return item;
    if (!_key) return null;
    try {
      const plain = JSON.parse(await _dec(_key, item.enc));
      return Object.assign({}, item, plain);
    } catch (e) { return null; }
  }

  return { isSetup, isUnlocked, setup, unlock, lock, encryptItem, decryptItem };
})();
