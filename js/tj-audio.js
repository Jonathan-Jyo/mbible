"use strict";
// ─────────────────────────────────────────────────────────────────────
// TjAudio — tojesus 폴더의 오디오(성경·예언의신·설교)를 재생 엔진이 다루는 약속
//
//   재생 엔진(js/play-engine.js)의 곡 id 는 매일찬양 곡이면 "ps-…", tojesus 오디오면
//   "tj:audiobible/개역한글/01_창세기/001.mp3" 처럼 tojesus 기준 경로에 "tj:" 를 붙인다.
//   소리는 "/_tojesus_/경로" 로 부르면 안드로이드가 그 자리에서 흘려 준다(TojesusMedia.java).
//
//   이어 듣기 — 파일마다 들은 자리를 기억한다(긴 설교·오디오북). 끝까지 들으면 「들음」으로 남긴다.
//   엔진 화면(player.html)과 오디오 화면이 같은 저장소(localStorage)를 본다.
// ─────────────────────────────────────────────────────────────────────
const TjAudio = (() => {
  const PREFIX = "tj:";
  const POS_KEY = "bible-listen-pos";     // { 경로: { pos, dur, done, at } }
  const LAST_KEY = "bible-listen-last";   // { list:[경로…], rel, at, title } — 「이어 듣기」
  const POS_MAX = 5000;                   // 기억해 둘 파일 수(성경 한 역본 1,189장) — 넘으면 오래된 것부터 지운다
  const RESUME_MIN_SEC = 5;               // 이보다 앞이면 처음부터
  const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|ogg|opus|wav|flac)$/i;

  const isId = (id) => typeof id === "string" && id.startsWith(PREFIX);
  const relOf = (id) => (isId(id) ? id.slice(PREFIX.length) : "");
  const idOf = (rel) => PREFIX + rel;
  const urlOf = (rel) => "/_tojesus_/" + String(rel).split("/").map(encodeURIComponent).join("/");
  const stripExt = (n) => String(n).replace(AUDIO_EXT, "");
  const numOf = (name) => { const m = String(name).match(/^(\d{1,4})/); return m ? +m[1] : null; };
  // "01_창세기" → "창세기", "003_시대의 소망" → "시대의 소망"
  const dropNum = (name) => String(name).replace(/^\d{1,4}[\s._-]*/, "") || String(name);

  // 파일 이름의 장 표시 — "001.mp3" → "1장", "003_겟세마네.mp3" → "3. 겟세마네"
  function chapterLabel(file) {
    const base = stripExt(file), n = numOf(base), rest = dropNum(base);
    if (n == null) return base;
    return rest && rest !== base ? `${n}. ${rest}` : `${n}장`;
  }

  // 화면·알림 줄에 보일 이름
  function titleOf(rel) {
    const seg = String(rel).split("/");
    const file = seg[seg.length - 1] || "";
    if (seg[0] === "audiobible" && seg.length >= 4) {
      const n = numOf(stripExt(file));
      return `${dropNum(seg[2])} ${n != null ? n + "장" : stripExt(file)} · ${seg[1]}`;
    }
    if (seg[0] === "audioegw" && seg.length >= 4) return `${dropNum(seg[2])} ${chapterLabel(file)}`;
    if (seg[0] === "audiosermon" && seg.length >= 3) return `${stripExt(file)} · ${seg[1]}`;
    return stripExt(file);
  }

  function _load(k, d) { try { return JSON.parse(localStorage.getItem(k) || "null") || d; } catch (e) { return d; } }
  function _save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { console.warn("[TjAudio] 들은 자리를 저장하지 못했습니다", e); }
  }

  const positions = () => _load(POS_KEY, {});
  function posOf(rel) { return positions()[rel] || null; }
  function savePos(rel, pos, dur, done) {
    const all = positions();
    // 「들음」은 끝까지 들었을 때 붙고, 다시 듣기 시작해 앞부분을 넘기면 떼어 낸다 — 이어 듣기가 그 자리로 가게
    const was = all[rel] || {};
    const relistening = !done && pos > RESUME_MIN_SEC;
    all[rel] = { pos: done ? 0 : Math.round(pos), dur: Math.round(dur || 0), done: !!done || (!!was.done && !relistening), at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > POS_MAX) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - POS_MAX).forEach(k => delete all[k]);
    _save(POS_KEY, all);
  }
  // 이어 들을 자리 — 끝까지 들었거나 앞부분이면 처음부터
  function resumeAt(rel) {
    const p = posOf(rel);
    if (!p || !p.pos || p.pos < RESUME_MIN_SEC) return 0;
    if (p.dur && p.pos > p.dur - RESUME_MIN_SEC) return 0;
    return p.pos;
  }

  const last = () => _load(LAST_KEY, null);
  function setLast(list, rel) { _save(LAST_KEY, { list, rel, at: Date.now(), title: titleOf(rel) }); }

  return { PREFIX, AUDIO_EXT, isId, relOf, idOf, urlOf, titleOf, chapterLabel, dropNum, numOf, stripExt,
           positions, posOf, savePos, resumeAt, last, setLast };
})();
