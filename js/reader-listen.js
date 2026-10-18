"use strict";
// ─────────────────────────────────────────────────────────────────────
// 그 장 듣기 — 성경읽기·화잇 책 화면에서 지금 읽는 장의 오디오를 튼다 (안드로이드 앱)
//
//   성경  tojesus/audiobible/<역본>/<01_창세기>/<001.mp3>
//         역본 칸은 지금 역본 이름과 같은 것(없으면 다른 역본), 책은 앞 번호(01~66)나 이름으로 찾는다
//   화잇  tojesus/audioegw/<KR·EN…>/<책>/<001….mp3>
//         책 칸은 약호(DA)·약칭(소망)·온 제목(시대의 소망 · The Desire of Ages) 무엇으로 지어도 찾는다.
//         장: 목차 이름의 장 번호(「2장 씨 뿌리는 자」·「Chapter 2」) — 목차에는 장 안의 작은 제목도 섞여 있어
//         차례 번호를 그대로 쓰면 어긋난다. 파일 이름에 장 제목이 있으면(「003_씨 뿌리는 자」) 제목을 먼저 맞춘다
//   그 장부터 그 책 끝까지 차례로 튼다 — 소리는 재생 엔진(화면 아래 미니바), 👂 말씀듣기와 같은 기록(이어 듣기·들음)
//
//   reader.html 의 전역(state·BOOKS·verNameShort·baseVersion·showToast·openBdb·egwChapters·EgwLink)을 쓴다.
// ─────────────────────────────────────────────────────────────────────
(function () {
  const T = () => window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins && Capacitor.Plugins.TojesusFolder;
  const coll = new Intl.Collator("ko", { numeric: true });
  // 견줄 때 — 정렬용 앞 번호(「01_」「01 」)만 떼고, 글자·숫자 말고는 모두 지운다(띄어쓰기·따옴표·—·?:).
  // 앞 번호는 구분자가 뒤따를 때만 뗀다 — 「1증언」「2증언」의 권 번호는 남아야 구별된다
  const norm = (t) => String(t || "").replace(/^\d{1,3}[_\s.\-]+/, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  // 폴더의 정렬용 앞 번호 — 「01_창세기」→ 1, 「1사무엘상」→ 없음
  const prefixNum = (t) => { const m = String(t || "").match(/^(\d{1,3})[_\s.\-]/); return m ? +m[1] : null; };
  const byName = (a, b) => coll.compare(a.split("/").pop(), b.split("/").pop());
  const fileBase = (p) => TjAudio.stripExt(p.split("/").pop());
  let busy = false;   // 찾는 동안 또 누르면 두 번 틀지 않게

  // 화잇 책 온 제목 — 오디오 폴더를 흔히 이 이름으로 짓는다(약칭만으로는 「소망」→「시대의소망」을 못 찾을 수 있다)
  const EGW_TITLES = {
    DA: ["시대의 소망", "The Desire of Ages"], SC: ["정로의 계단", "Steps to Christ"],
    COL: ["실물교훈", "Christ's Object Lessons"], GC: ["각 시대의 대쟁투", "대쟁투", "The Great Controversy"],
    PP: ["부조와 선지자", "Patriarchs and Prophets"], PK: ["선지자와 왕", "Prophets and Kings"],
    AA: ["사도행적", "The Acts of the Apostles"], MB: ["산상보훈", "Thoughts from the Mount of Blessing"],
    MH: ["치료봉사", "The Ministry of Healing"], Ed: ["교육", "Education"], EW: ["초기문집", "Early Writings"],
    AH: ["가정", "The Adventist Home"], CT: ["부모와 교사와 학생에게 주는 권면", "Counsels to Parents, Teachers, and Students"],
    MYP: ["청년에게 주는 기별", "Messages to Young People"], CG: ["자녀지도법", "Child Guidance"],
    Ev: ["전도", "Evangelism"], CD: ["식생활과 음식물에 관한 권면", "Counsels on Diet and Foods"],
    LS: ["화잇 자서전", "Life Sketches"], SL: ["성화의 생애", "The Sanctified Life"], GW: ["복음의 일꾼", "Gospel Workers"]
  };

  // 화면을 열 때 tojesus 가 연결되어 있으면 👂 단추들이 보이게(body.can-listen)
  async function init() {
    if (!T()) return;
    try { const st = await T().status(); if (st.linked && st.ok) document.body.classList.add("can-listen"); }
    catch (e) { console.warn("[그 장 듣기] tojesus 연결을 확인하지 못했습니다", e); }
  }
  document.addEventListener("DOMContentLoaded", init);

  async function scan(area) {
    try { return ((await T().scan({ sub: area })).files || []).map(f => f.path).filter(p => TjAudio.AUDIO_EXT.test(p)); }
    catch (e) { showToast("tojesus 폴더를 읽지 못했습니다 — 첫화면 ⚙ 설정에서 재등록해 주세요"); return null; }
  }
  function play(list, start) {
    PlayEngine.cmd("playList", { list: list.map(TjAudio.idOf), start: TjAudio.idOf(start), mode: "order", source: "listen" });
  }

  // ── 성경 ─────────────────────────────────────────────────────────────
  window.listenHere = async function () {
    if (!T() || busy) return;
    busy = true;
    try { await listenBible(); } finally { busy = false; }
  };
  async function listenBible() {
    showToast("성경 오디오를 찾는 중…");
    const files = await scan("audiobible");
    if (!files) return;
    const vers = [...new Set(files.map(p => p.split("/")[1]))].sort();
    if (!vers.length) { showToast("tojesus/audiobible 에 성경 오디오가 없습니다"); return; }
    const want = norm(verNameShort(baseVersion()));
    // 같은 이름이 먼저 — 부분 일치는 세 글자 넘을 때만(「KJV」를 찾다 「NKJV」를 고르지 않게)
    const ver = vers.find(v => norm(v) === want) ||
      vers.find(v => norm(v).length >= 3 && want.length >= 3 && (norm(v).includes(want) || want.includes(norm(v)))) || vers[0];
    const bookNum = state.bookIdx + 1, koName = BOOKS[state.bookIdx][1];
    const books = [...new Set(files.filter(p => p.split("/")[1] === ver).map(p => p.split("/")[2]))];
    // 이름이 먼저, 그다음 정렬용 앞 번호(「01_」) — 「1사무엘상」의 1 을 창세기로 보지 않게
    const book = books.find(b => norm(b) === norm(koName)) || books.find(b => prefixNum(b) === bookNum);
    if (!book) { showToast(`${ver} 오디오에 ${koName}이(가) 없습니다`); return; }
    const list = files.filter(p => { const s = p.split("/"); return s[1] === ver && s[2] === book; }).sort(byName);
    const start = list.find(p => TjAudio.numOf(fileBase(p)) === state.chapter);
    if (!start) { showToast(`${koName} ${state.chapter}장 오디오가 없습니다 — ${list.length}개 장만 있습니다`); return; }
    play(list, start);
    showToast(`👂 ${koName} ${state.chapter}장부터 · ${ver}` + (norm(ver) !== want ? " (이 역본 오디오가 없어 대신)" : ""));
  }

  // ── 화잇 책 ──────────────────────────────────────────────────────────
  // 이 책을 가리키는 이름들 — 오디오 폴더 이름과 견준다
  function egwNames(code) {
    return [code, EgwLink.codeLabel(code), ...(EGW_TITLES[code] || [])].map(norm).filter(n => n.length >= 2);
  }
  function findEgwBook(dirs, code) {
    const names = egwNames(code);
    return dirs.find(d => names.includes(norm(d))) ||
      dirs.find(d => names.some(n => n.length >= 3 && (norm(d).includes(n) || n.includes(norm(d)))));
  }

  // ── 지금 쪽이 든 장 ── 실제 화잇 책 목차를 보고 정한 규칙(2026-10-18, ko_PK·ko_GC·ko_COL·ko_DA)
  //   · 장 이름의 번호: 「2장 …」「1 장 — …」「Chapter 2—…」「2. …」 — 책 하나에서 가장 많이 맞는 꼴 하나만 쓴다
  //     (번호 붙은 소제목이 있는 책에서 꼴이 섞여 엉뚱한 번호를 잡지 않게)
  //   · 번호 없는 이름이 번호 장 **사이에 하나 비는 자리**(0장 → 1편 → 2장)에 있으면 그 빠진 장이다 —
  //     편이 시작하는 쪽에서는 장 이름 자리에 편 제목이 들어가 있다(선지자와 왕)
  //   · 그 밖의 번호 없는 이름은 앞 장 안의 작은 제목이다(대쟁투·실물교훈)
  //   · 첫 번호 장 앞(서문 등)은 「장 없음」 — 1장으로 둔갑시키지 않는다
  const CH_RES = [
    /^(\d{1,3})\s*장(?![가-힣])[\s—–:.\-]*/,          // 2장 · 1 장 — (「12 장애물」의 장은 낱말이라 빼고)
    /^chapter\s*(\d{1,3})\b[\s—–:.\-]*/i,
    /^(\d{1,3})[.)][\s—–\-]*/
  ];
  function chapterMap(chapters) {
    const counts = CH_RES.map(re => chapters.filter(c => re.test(c.name)).length);
    const best = counts.indexOf(Math.max(...counts));
    if (!counts[best]) return null;                         // 장 번호가 없는 책
    const re = CH_RES[best];
    const items = chapters.map(c => {
      const m = c.name.match(re);
      return m ? { page: c.page, num: +m[1], title: c.name.replace(re, "").trim(), name: c.name } : { page: c.page, num: null, title: c.name, name: c.name };
    });
    // 하나 빈 자리를 메운다
    for (let i = 0; i < items.length; i++) {
      if (items[i].num != null) continue;
      let p = i - 1; while (p >= 0 && items[p].num == null) p--;
      let n = i + 1; while (n < items.length && items[n].num == null) n++;
      const firstAfterPrev = p >= 0 && p === i - 1;
      if (firstAfterPrev && n < items.length && items[n].num === items[p].num + 2) items[i] = Object.assign({}, items[i], { num: items[p].num + 1, inferred: true });
    }
    return items;
  }
  function currentChapter(chapters, page) {
    const map = chapterMap(chapters);
    if (!map) {                                            // 번호가 없는 책 — 목차 차례
      let ci = 0;
      chapters.forEach((c, i) => { if (c.page <= page) ci = i; });
      return { num: ci + 1, title: chapters[ci].name, byOrder: true };
    }
    let hit = null;
    map.forEach(x => { if (x.num != null && x.page <= page) hit = x; });
    if (!hit) {                                            // 첫 장 앞 — 서문 등
      let pre = null;
      map.forEach(x => { if (x.page <= page) pre = x; });
      return { num: null, title: pre ? pre.title : "", before: map.find(x => x.num != null) };
    }
    // 메운 장은 그 이름이 편 제목이라 파일 제목과 맞지 않는다 — 번호로만 찾는다
    return { num: hit.num, title: hit.inferred ? "" : hit.title };
  }

  window.listenEgw = async function () {
    if (!T() || !state._egw || busy) return;
    busy = true;
    try { await listenEgwBook(); } finally { busy = false; }
  };
  async function listenEgwBook() {
    const g = state._egw;
    const pid = (g.mode === "en") ? g.ids.en : (g.ids.ko || g.ids.en);
    let chapters = [];
    try { chapters = egwChapters(await openBdb(pid), pid); } catch (e) { /* 장 구분이 없는 책 */ }
    if (!chapters.length) { showToast("이 책에는 장 구분이 없어 장을 찾을 수 없습니다"); return; }
    const ch = currentChapter(chapters, g.shown || g.page);
    showToast("화잇 오디오를 찾는 중…");
    const files = await scan("audioegw");
    if (!files) return;
    // 지금 보는 말을 먼저 — 한글로 읽으면 KR, 영문이면 EN. 없으면 다른 말
    const langs = [...new Set(files.map(p => p.split("/")[1]))];
    const prefer = g.mode === "en" ? ["EN", "KR"] : ["KR", "EN"];
    const order = [...prefer.map(l => langs.find(x => x.toUpperCase() === l)).filter(Boolean),
                   ...langs.filter(x => !prefer.includes(x.toUpperCase()))];
    const label = EgwLink.codeLabel(g.code);
    let missing = null;
    for (const lang of order) {
      const dirs = [...new Set(files.filter(p => p.split("/")[1] === lang).map(p => p.split("/")[2]))];
      const book = findEgwBook(dirs, g.code);
      if (!book) continue;
      const list = files.filter(p => { const s = p.split("/"); return s[1] === lang && s[2] === book; }).sort(byName);
      const t = norm(ch.title);
      // 제목이 맞는 파일이 먼저(서론 파일 때문에 번호가 밀려도 맞는다), 없으면 번호
      const byTitle = t.length >= 2 ? list.find(p => norm(fileBase(p)) === t || norm(fileBase(p)).endsWith(t)) : null;
      if (ch.num == null) {                                // 첫 장 앞(서문)
        if (byTitle) { play(list, byTitle); showToast(`👂 ${label} 「${ch.title}」부터 · ${lang}`); return; }
        showToast(`이 쪽은 ${ch.before ? ch.before.num + "장" : "첫 장"} 앞${ch.title ? `(「${ch.title}」)` : ""}입니다 — 그 오디오가 없습니다. 장으로 넘어가서 눌러 주세요`);
        return;
      }
      const byNum = list.find(p => TjAudio.numOf(fileBase(p)) === ch.num);
      const start = byTitle || byNum;
      if (!start) { missing = missing || `${label} ${ch.num}장 오디오가 없습니다 — ${lang} 에 ${list.length}개 장만 있습니다`; continue; }
      play(list, start);
      showToast(`👂 ${label} ${ch.num}장${ch.title ? ` 「${ch.title}」` : ""}부터 · ${lang}` + (byTitle ? "" : " (장 번호로 찾음)"));
      return;
    }
    showToast(missing || `tojesus/audioegw 에 「${label}」 오디오가 없습니다 — 폴더 이름을 「${g.code}」나 「${(EGW_TITLES[g.code] || [label])[0]}」로 지어 주세요`);
  }
})();
