// ============================================================================
// ShareStore — 매일나눔 데이터 (VIP 카드 · 나눔 기록)
// ----------------------------------------------------------------------------
// · VIP 카드: 이름·단계·태그는 평문(목록·통계·달력용),
//   연락처·카톡·이메일·생년월일·메모는 enc(암호문) 안에만 저장 — 사용자 확정 방침
// · PIN은 비밀기도와 별도 (bible-share-crypt, BibleCrypt 공장 사용)
// · 나눔 기록: 날짜·VIP·방법·한줄메모 (달력·종합달력 재료)
// ============================================================================

const ShareCrypt = BibleCrypt.makeCrypt("bible-share-crypt");

const ShareStore = (() => {
  const K_VIPS = "bible-share-vips";
  const K_LOG  = "bible-share-log";

  const STAGES = ["관심", "친교", "성경공부", "결심", "침례", "정착", "제자훈련"];
  const METHODS = ["말씀카드", "찬양", "전화", "문자", "방문", "식사", "선물", "기타"];

  const _load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  const _save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const _id = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // 로컬 기준 날짜 — toISOString(UTC)은 한국 새벽(0~9시)에 하루 전 날짜가 되므로 금지
  const _localDay = (d) => { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const today = () => _localDay(new Date());

  // ── VIP 카드 ──────────────────────────────────────────────────────────
  function vips() { return _load(K_VIPS, []); }
  function saveVips(arr) { _save(K_VIPS, arr); }

  // info = { phone, email, birth, birthCal, addr, memo } — 평문 저장.
  // 휴대폰 주소록에 비밀번호를 걸지 않듯 연락처도 잠그지 않는다(사용자 확정).
  // enc는 예전에 잠가 둔 자료를 풀기 전까지만 남아 있는 자리다.
  function add(data, encBlob) {
    const vip = {
      id: _id("vip"),
      name:  data.name || "",                 // 평문 — 목록에서 바로 보이도록 (사용자 확정)
      family: data.family || "",              // 가족대표 이름 (평문 — 가족 묶음 파악용)
      gender: data.gender || "",              // "남" | "여" | ""
      stage: STAGES.includes(data.stage) ? data.stage : STAGES[0],
      start: data.start || today(),
      tags:  Array.isArray(data.tags) ? data.tags : [],
      info:  data.info || {},                 // 연락처·이메일·생년월일·주소·메모 (평문)
      enc:   encBlob || null,                 // 옛 암호문 자리 — 이관 전까지만 남는다
      prayId: data.prayId || null,            // 매일기도의 연결된 기도제목
      createdAt: Date.now(), updatedAt: Date.now()
    };
    const arr = vips(); arr.push(vip); saveVips(arr);
    return vip;
  }

  function update(id, patch) {
    const arr = vips();
    const i = arr.findIndex(x => x.id === id);
    if (i < 0) return null;
    arr[i] = Object.assign({}, arr[i], patch, { updatedAt: Date.now() });
    saveVips(arr);
    return arr[i];
  }

  function remove(id) {
    saveVips(vips().filter(x => x.id !== id));
    _save(K_LOG, log().filter(x => x.vipId !== id));
  }

  // ── 나눔 기록 ─────────────────────────────────────────────────────────
  function log() { return _load(K_LOG, []); }
  function addLog(vipId, method, memo) {
    const arr = log();
    arr.push({ id: _id("sh"), date: today(), vipId, method: METHODS.includes(method) ? method : "기타", memo: String(memo || "").trim() });
    _save(K_LOG, arr);
    return arr[arr.length - 1];
  }
  function removeLog(id) { _save(K_LOG, log().filter(x => x.id !== id)); }

  // VIP별 마지막 나눔일 → "N일 전" 정렬용
  function lastShared(vipId) {
    const dates = log().filter(x => x.vipId === vipId).map(x => x.date).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }
  function daysSince(dateStr) {
    if (!dateStr) return null;
    return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
  }

  return { STAGES, METHODS, today, vips, saveVips, add, update, remove,
           log, addLog, removeLog, lastShared, daysSince };
})();
