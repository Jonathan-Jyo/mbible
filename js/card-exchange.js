// ============================================================================
// CardExchange — 기도카드·VIP카드를 신뢰하는 사람과 주고받기
// ----------------------------------------------------------------------------
// 보내기: ① 내 PIN으로 승인(비밀 내용 복호화) → ② 전달용 비밀번호를 정해
//         AES-GCM으로 잠근 .json 파일 생성 → ③ 카톡 등 공유시트로 전달
//         (전달용 비밀번호는 파일과 다른 길로 — 말·전화로 알려 준다)
// 받기:   전달용 비밀번호로 열어 미리보고, 비밀 내용은 "받는 사람 자신의 PIN"으로
//         다시 잠가 저장한다 — 보낸 사람의 PIN은 어디에도 남지 않는다
// ============================================================================

const CardExchange = (() => {
  const MAGIC = "jesus-card";
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function _key(pass, saltB64, iter) {
    const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: unb64(saltB64), iterations: iter, hash: "SHA-256" },
      raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  // kind: "pray" | "vip"  ·  payload: 평문 객체
  //  pass: 전달용 비밀번호 — 비우면(일반 카드) 잠그지 않고 그대로 담는다.
  //  숨길 것이 없는 기도제목까지 비밀번호를 주고받게 하면 전달만 번거로워지므로,
  //  잠그는 것은 🔒 비밀 기도카드에만 적용한다.
  async function pack(kind, payload, pass) {
    if (!pass) return JSON.stringify({ app: MAGIC, v: 1, kind, enc: false, payload }, null, 0);
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
    const iter = 150000;
    const key = await _key(pass, salt, iter);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
    const out = new Uint8Array(iv.length + ct.byteLength);
    out.set(iv); out.set(new Uint8Array(ct), iv.length);
    return JSON.stringify({ app: MAGIC, v: 1, kind, salt, iter, data: b64(out.buffer) }, null, 0);
  }

  // 파일이 비밀번호로 잠겨 있는가 — 받는 쪽이 비밀번호를 물을지 판단할 때 쓴다
  function isLocked(jsonStr) {
    try { const o = JSON.parse(jsonStr); return !!(o && o.app === MAGIC && o.enc !== false && o.data); }
    catch (e) { return false; }
  }

  async function unpack(jsonStr, pass) {
    let obj;
    try { obj = JSON.parse(jsonStr); } catch (e) { throw new Error("카드 파일이 아닙니다."); }
    if (!obj || obj.app !== MAGIC) throw new Error("카드 파일이 아닙니다.");
    if (obj.enc === false) return { kind: obj.kind, payload: obj.payload };   // 잠그지 않은 일반 카드
    if (!obj.data) throw new Error("카드 파일이 아닙니다.");
    const key = await _key(pass, obj.salt, obj.iter || 150000);
    const buf = unb64(obj.data);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12)); }
    catch (e) { throw new Error("전달용 비밀번호가 일치하지 않습니다."); }
    return { kind: obj.kind, payload: JSON.parse(new TextDecoder().decode(plain)) };
  }

  // 파일 공유: APK는 네이티브 공유시트(카톡), 웹은 다운로드
  async function shareFile(fileName, jsonStr, title) {
    const Cap = window.Capacitor, FS = Cap && Cap.Plugins && Cap.Plugins.Filesystem, SH = Cap && Cap.Plugins && Cap.Plugins.Share;
    if (FS && SH) {
      const w = await FS.writeFile({ path: fileName, data: btoa(unescape(encodeURIComponent(jsonStr))), directory: "CACHE" });
      await SH.share({ title, files: [w.uri] });
      return "shared";
    }
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return "downloaded";
  }

  const safeName = (s) => String(s || "카드").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 30);

  return { pack, unpack, isLocked, shareFile, safeName };
})();
