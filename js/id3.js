// ============================================================================
// ID3 — mp3 파일의 태그를 읽어 찬양 정보 자동 채움에 쓴다 (외부 라이브러리 없음)
// ----------------------------------------------------------------------------
// 지원: ID3v2.3 / v2.4 (파일 앞부분) + ID3v1 (파일 끝 128바이트) 폴백
//  · TIT2 제목 · TPE1 연주자/가수 · TCOM 작곡자 · TEXT 작사자
//  · TALB 앨범 · USLT 가사
// m4a 등 다른 포맷은 태그 구조가 달라 지원하지 않음 (파일 자체는 음원으로 사용 가능)
// ============================================================================

const ID3 = (() => {
  const _dec = (bytes, enc) => {
    try {
      if (enc === 0) return new TextDecoder("latin1").decode(bytes);
      if (enc === 1) return new TextDecoder("utf-16").decode(bytes);       // BOM 포함
      if (enc === 2) return new TextDecoder("utf-16be").decode(bytes);
      return new TextDecoder("utf-8").decode(bytes);
    } catch (e) { return ""; }
  };
  const _clean = (s) => String(s || "").replace(/\0+/g, "").trim();
  const _syncsafe = (b, i) => (b[i] << 21) | (b[i + 1] << 14) | (b[i + 2] << 7) | b[i + 3];

  // ── ID3v2 (파일 앞) ───────────────────────────────────────────────────
  function _parseV2(buf) {
    const b = new Uint8Array(buf);
    if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;   // "ID3"
    const ver = b[3];                                    // 3=v2.3, 4=v2.4
    if (ver < 3) return null;                            // v2.2(3글자 프레임)는 미지원
    const tagSize = _syncsafe(b, 6) + 10;
    const out = {};
    let i = 10;
    // 확장 헤더 건너뛰기
    if (b[5] & 0x40) i += (ver === 4 ? _syncsafe(b, 10) : ((b[10] << 24) | (b[11] << 16) | (b[12] << 8) | b[13]) + 4);
    while (i + 10 <= Math.min(tagSize, b.length)) {
      const id = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;              // 패딩 도달
      const size = ver === 4 ? _syncsafe(b, i + 4) : ((b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7]);
      if (size <= 0 || i + 10 + size > b.length) break;
      const body = b.subarray(i + 10, i + 10 + size);
      if (id === "USLT" && body.length > 4) {
        // [인코딩1][언어3][설명\0][가사]
        const enc = body[0];
        let p = 4;
        const nul = enc === 1 || enc === 2 ? 2 : 1;      // utf16은 \0\0
        while (p + nul <= body.length && !(body[p] === 0 && (nul === 1 || body[p + 1] === 0))) p += nul;
        out.lyrics = _clean(_dec(body.subarray(p + nul), enc));
      } else if (id[0] === "T" && body.length > 1) {
        const text = _clean(_dec(body.subarray(1), body[0]));
        if (text) {
          if (id === "TIT2") out.title = text;
          else if (id === "TPE1") out.performer = text;
          else if (id === "TCOM") out.composer = text;
          else if (id === "TEXT") out.lyricist = text;
          else if (id === "TALB") out.album = text;
        }
      }
      i += 10 + size;
    }
    return Object.keys(out).length ? out : null;
  }

  // ── ID3v1 (파일 끝 128바이트) — 옛 파일 폴백 ─────────────────────────
  function _parseV1(buf) {
    const b = new Uint8Array(buf);
    if (b.length < 128) return null;
    const t = b.subarray(b.length - 128);
    if (t[0] !== 0x54 || t[1] !== 0x41 || t[2] !== 0x47) return null;      // "TAG"
    // 한글 mp3는 대개 EUC-KR — 시도 후 실패하면 latin1
    const dec = (s, e) => { try { return _clean(new TextDecoder("euc-kr").decode(s)); } catch (err) { return _clean(new TextDecoder("latin1").decode(s)); } };
    const out = { title: dec(t.subarray(3, 33)), performer: dec(t.subarray(33, 63)), album: dec(t.subarray(63, 93)) };
    return out.title || out.performer ? out : null;
  }

  // 파일 → { title, performer, composer, lyricist, album, lyrics } (없으면 null)
  async function read(file) {
    try {
      const head = await file.slice(0, 1024 * 1024).arrayBuffer();         // 태그는 앞 1MB 안
      const v2 = _parseV2(head);
      if (v2) return v2;
      const tail = await file.slice(Math.max(0, file.size - 128)).arrayBuffer();
      return _parseV1(tail);
    } catch (e) { return null; }
  }

  return { read };
})();
