// ============================================================================
// BibleCrypt — PIN 기반 암호화 공장 (AES-GCM 256 + PBKDF2 15만회)
// ----------------------------------------------------------------------------
// makeCrypt(storageKey)로 서로 다른 PIN 영역을 만든다.
//  · 매일나눔 VIP 카드: makeCrypt("bible-share-crypt")  ← 비밀기도와 별도 PIN
//  · PIN은 어디에도 저장하지 않고 키만 유도 — 분실 시 복구 불가
//  · (매일기도의 PrayCrypt는 같은 방식의 선행 구현 — 추후 이 공장으로 통합 예정)
// ============================================================================

const BibleCrypt = (() => {
  const CHECK_PLAIN = "crypt-ok";
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  function makeCrypt(storageKey) {
    let _key = null;                       // 세션 동안만 메모리에 유지

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

    function meta() { try { return JSON.parse(localStorage.getItem(storageKey) || "null"); } catch (e) { return null; } }
    const isSetup = () => !!meta();
    const isUnlocked = () => !!_key;
    const lock = () => { _key = null; };

    async function setup(pin) {
      if (isSetup()) throw new Error("이미 PIN이 설정되어 있습니다.");
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
      const iter = 150000;
      const key = await _derive(pin, salt, iter);
      const check = await _enc(key, CHECK_PLAIN);
      localStorage.setItem(storageKey, JSON.stringify({ salt, iter, check }));
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

    // 객체 → 암호문 / 암호문 → 객체 (잠금 상태면 null)
    async function encObj(obj) {
      if (!_key) throw new Error("잠금 해제가 필요합니다.");
      return _enc(_key, JSON.stringify(obj));
    }
    async function decObj(packed) {
      if (!packed) return {};
      if (!_key) return null;
      try { return JSON.parse(await _dec(_key, packed)); } catch (e) { return null; }
    }

    // PIN 변경 — 현재 PIN으로 잠금 해제된 상태에서, 앱이 넘겨준 reencrypt 콜백으로
    // 기존 암호문을 모두 새 키로 다시 암호화한다. reencrypt(decOld, encNew)
    async function changePin(newPin, reencrypt) {
      if (!_key) throw new Error("먼저 현재 PIN으로 잠금을 해제해 주세요.");
      const oldKey = _key;
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
      const iter = 150000;
      const newKey = await _derive(newPin, salt, iter);
      const decOld = async (packed) => { try { return JSON.parse(await _dec(oldKey, packed)); } catch (e) { return null; } };
      const encNew = async (obj) => _enc(newKey, JSON.stringify(obj));
      await reencrypt(decOld, encNew);
      const check = await _enc(newKey, CHECK_PLAIN);
      localStorage.setItem(storageKey, JSON.stringify({ salt, iter, check }));
      _key = newKey;
    }

    // PIN 분실 초기화 — 키를 버린다. 암호문 복구는 불가능하므로 호출측이
    // 비밀 데이터를 함께 정리해야 한다.
    function reset() { localStorage.removeItem(storageKey); _key = null; }

    return { isSetup, isUnlocked, lock, setup, unlock, encObj, decObj, changePin, reset };
  }

  return { makeCrypt };
})();
