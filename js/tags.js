// ============================================================================
// BibleTags — 해시태그 공용 모듈 (허브 검색 · 기도 · 암송 · 찬양 · 나눔)
// ----------------------------------------------------------------------------
// · parse():   "#믿음 #가족" 또는 본문 속 인라인 #태그 를 추출
// · auto():    제목·내용에서 핵심 단어를 골라 자동 태그 제안 (조사 제거 휴리스틱)
// · searchAll(): 모든 모듈의 localStorage 데이터를 한 번에 검색 (허브 검색창용)
//   - 🔒 비밀기도는 내용을 읽지 않고 건수만 알려 준다
// ============================================================================

const BibleTags = (() => {
  // 자동 태그에서 걸러낼 흔한 말 (조사·접속어·일반어)
  const STOP = new Set([
    "그리고", "그러나", "그런데", "하지만", "위해", "위하여", "대한", "대하여", "함께",
    "있는", "있다", "없는", "없다", "하는", "하다", "되다", "되는", "것", "수", "때",
    "오늘", "내일", "매일", "기도", "감사", "주님", "하나님", "예수님"
  ]);
  const JOSA = /(에게서|으로서|으로써|에서|에게|께서|까지|부터|보다|처럼|으로|라서|이며|이고|와|과|의|가|이|을|를|은|는|로|에|도|만|께)$/;

  // 66권 한국어 책이름 (허브에서 메모 주소 표시용)
  const BOOK_KO = ["창세기","출애굽기","레위기","민수기","신명기","여호수아","사사기","룻기",
    "사무엘상","사무엘하","열왕기상","열왕기하","역대상","역대하","에스라","느헤미야","에스더",
    "욥기","시편","잠언","전도서","아가","이사야","예레미야","예레미야애가","에스겔","다니엘",
    "호세아","요엘","아모스","오바댜","요나","미가","나훔","하박국","스바냐","학개","스가랴","말라기",
    "마태복음","마가복음","누가복음","요한복음","사도행전","로마서","고린도전서","고린도후서",
    "갈라디아서","에베소서","빌립보서","골로새서","데살로니가전서","데살로니가후서","디모데전서",
    "디모데후서","디도서","빌레몬서","히브리서","야고보서","베드로전서","베드로후서",
    "요한일서","요한이서","요한삼서","유다서","요한계시록"];

  function normalize(t) {
    return String(t || "").replace(/^#/, "").trim().replace(/\s+/g, "");
  }

  // 문자열(입력란 값 또는 본문)에서 #태그 추출
  function parse(text) {
    const out = [];
    const re = /#([^\s#,]+)/g;
    let m;
    while ((m = re.exec(String(text || "")))) { const t = normalize(m[1]); if (t && !out.includes(t)) out.push(t); }
    return out;
  }

  // 제목·내용에서 핵심 단어 자동 추출 (최대 max개)
  function auto(texts, max) {
    const limit = max || 4;
    const words = String(Array.isArray(texts) ? texts.join(" ") : texts || "")
      .replace(/[^가-힣a-zA-Z0-9\s]/g, " ")
      .split(/\s+/).filter(Boolean);
    const out = [];
    for (let w of words) {
      if (w.length < 2) continue;
      const stripped = w.length > 2 ? w.replace(JOSA, "") : w;   // 조사 제거
      if (stripped.length < 2 || STOP.has(stripped) || STOP.has(w)) continue;
      if (!out.includes(stripped)) out.push(stripped);
      if (out.length >= limit) break;
    }
    return out;
  }

  // 입력란 값 → 최종 태그 배열 (# 있어도 없어도, 쉼표·공백 구분 허용)
  function fromInput(value) {
    const out = [];
    String(value || "").split(/[\s,]+/).forEach(tok => {
      const t = normalize(tok);
      if (t && !out.includes(t)) out.push(t);
    });
    return out;
  }

  function toInput(tags) { return (tags || []).map(t => "#" + t).join(" "); }

  const _get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };

  // ── 통합 검색 (허브) ──────────────────────────────────────────────────
  // q: 검색어 (#으로 시작하면 태그 우선). 반환: [{app, icon, title, sub, href}]
  function searchAll(q) {
    const query = String(q || "").trim();
    if (!query) return [];
    const isTag = query.startsWith("#");
    const needle = normalize(query).toLowerCase();
    if (!needle) return [];
    const hit = (text) => String(text || "").toLowerCase().includes(needle);
    const hitTags = (tags) => (tags || []).some(t => t.toLowerCase().includes(needle));
    const results = [];

    // ① 성경암송 — 사용자 성경절 (주제·본문·장절·태그)
    for (const v of _get("bible-user-verses", [])) {
      const inlineTags = parse(v.topic + " " + (v.verse || ""));
      const tags = (v.tags || []).concat(inlineTags);
      if (isTag ? hitTags(tags) : (hit(v.topic) || hit(v.verse) || hit(v.reference) || hitTags(tags)))
        results.push({ app: "암송", icon: "✦", title: v.topic || v.reference,
          sub: `${v.reference || ""} ${(v.verse || "").slice(0, 40)}`, tags, href: "key.html" });
    }

    // ② 성경읽기 — 묵상 메모 (본문 + 인라인 #태그)
    const marks = _get("bible-reader-marks", {});
    for (const key in marks) {
      const memo = marks[key] && marks[key].memo;
      if (!memo) continue;
      const tags = parse(memo);
      if (isTag ? hitTags(tags) : (hit(memo) || hitTags(tags))) {
        const [b, c, v] = key.split("|").map(Number);
        results.push({ app: "읽기", icon: "📖", title: `${BOOK_KO[b - 1] || "?"} ${c}:${v} 메모`,
          sub: memo.slice(0, 60), tags, href: "reader.html" });
      }
    }

    // ③ 매일기도 — 기도제목(비밀 제외)·감사노트
    let secretHits = 0;
    for (const p of _get("bible-pray-items", [])) {
      if (!p) continue;
      if (p.secret) { secretHits++; continue; }             // 🔒 내용을 읽지 않는다
      const tags = (p.tags || []).concat(parse(p.title + " " + p.content));
      if (isTag ? hitTags(tags) : (hit(p.title) || hit(p.content) || hit(p.target) || hitTags(tags)))
        results.push({ app: "기도", icon: "🙏", title: p.title,
          sub: `${p.target} · ${p.type}${p.promiseRef ? " · 📖" + p.promiseRef : ""}`, tags: p.tags, href: "pray.html" });
    }
    for (const t of _get("bible-pray-thanks", [])) {
      const tags = parse(t.text);
      if (isTag ? hitTags(tags) : (hit(t.text) || hitTags(tags)))
        results.push({ app: "감사", icon: "🧡", title: t.text.slice(0, 40), sub: t.date, tags, href: "pray.html" });
    }
    if (secretHits && !isTag) results.push({ app: "기도", icon: "🔒", title: "비밀기도는 검색에서 제외됩니다",
      sub: "매일기도 앱에서 PIN으로 열람해 주세요", tags: [], href: "pray.html", muted: true });

    // ④ 매일찬양 — 제목·작곡·작사·연주자·주제성경절·가사·태그
    for (const s of _get("bible-praise-items", [])) {
      if (!s) continue;
      const tags = (s.tags || []).concat(parse(s.lyrics || ""));
      const fields = [s.title, s.composer, s.lyricist, s.performer, s.verseRef, s.lyrics];
      if (isTag ? hitTags(tags) : (fields.some(hit) || hitTags(tags)))
        results.push({ app: "찬양", icon: "🎵", title: s.title,
          sub: [s.category, s.performer, s.verseRef && "📖" + s.verseRef].filter(Boolean).join(" · "), tags: s.tags, href: "praise.html" });
    }

    // ⑤ 매일나눔 — VIP 이름(평문)·단계·태그 (연락처·메모는 암호화라 검색하지 않음)
    for (const v of _get("bible-share-vips", [])) {
      if (!v) continue;
      if (isTag ? hitTags(v.tags) : (hit(v.name) || hit(v.stage) || hitTags(v.tags)))
        results.push({ app: "나눔", icon: "💝", title: v.name,
          sub: `${v.stage}${v.start ? " · " + v.start + " 시작" : ""}`, tags: v.tags, href: "share.html" });
    }

    return results;
  }

  // ── 태그 입력란에 # 자동 부착 ─────────────────────────────────────────
  //  "기도 응답" 처럼 띄어쓰기로만 쳐도 "#기도 #응답"으로 보이게.
  //  한글 조합(IME) 중에는 값을 건드리면 글자가 깨지므로 조합이 끝난 뒤에만 정리한다.
  function attachAutoHash(el) {
    if (!el) return;
    const fmt = () => {
      const v = el.value;
      if (!v.trim()) return;
      const endSp = /\s$/.test(v);
      const nv = v.split(/\s+/).filter(Boolean).map(t => "#" + t.replace(/^#+/, "")).join(" ") + (endSp ? " " : "");
      if (nv !== v) {
        el.value = nv;
        try { el.setSelectionRange(nv.length, nv.length); } catch (e) {}
      }
    };
    el.addEventListener("input", (e) => { if (e.isComposing) return; fmt(); });
    el.addEventListener("compositionend", fmt);
    el.addEventListener("blur", fmt);
  }

  return { parse, auto, fromInput, toInput, normalize, searchAll, attachAutoHash, BOOK_KO };
})();
