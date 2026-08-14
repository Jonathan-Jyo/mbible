// ============================================================================
// egw-link — EGW 인덱스의 참조 한 줄("소망 44")을 풀이하고, 어디서 열지 정한다
// ----------------------------------------------------------------------------
// 인덱스 한 칸(btext)은 성경절 하나에 딸린 화잇 저서 참조 목록이다. 줄마다
// 「약칭 쪽」이 적혀 있고, 그 쪽수는 언제나 영문판 기준이라 변하지 않는다.
//
// 여는 차례 (형제앱 「함께 예수께로」와 맞춘 것 · 2026-08-14 제작자 확정)
//   ① 앱 안 한글 본문  ko_*.wdb
//   ② 앱 안 영문 본문  *.wdb      — 한글본이 없는 책이거나 사용자가 영문을 고를 때
//   ③ 폴더 자료        화잇주석 .cdb 등
//   ④ 바깥             EGW Writings 한글 → 영문
//
// 약호표는 docs/egw-books.json 을 옮긴 것이다(제작자 약어표, 인덱스 58종 전부).
// 여기에 박아 둔 까닭: 자료 하나를 더 받아 오는 실패 지점을 만들지 않으려는 것.
// 약호표가 바뀌면 json 을 고치고 이 파일을 다시 뽑는다.
// ============================================================================
(function () {
  "use strict";

  // 약칭 → [영문코드, 한글본이 egwwritings 에 있는가]
  // 긴 약칭이 먼저 오도록 정렬돼 있다 — "화잇주석 5권" 이 "화잇주석" 보다 먼저 맞아야 한다.
  var BOOKS = {
    "화잇주석 1권": ["1BC", false],
    "화잇주석 2권": ["2BC", false],
    "화잇주석 3권": ["3BC", false],
    "화잇주석 4권": ["4BC", false],
    "화잇주석 5권": ["5BC", false],
    "화잇주석 6권": ["6BC", false],
    "화잇주석 7권": ["7BC", false],
    "4SG-a": ["4aSG", false],
    "1기별": ["1SM", true],
    "1보감": ["1TT", true],
    "1증언": ["1T", true],
    "2SG": ["2SG", false],
    "2기별": ["2SM", true],
    "2보감": ["2TT", true],
    "2증언": ["2T", true],
    "3SG": ["3SG", false],
    "3기별": ["3SM", true],
    "3보감": ["3TT", true],
    "3증언": ["3T", true],
    "4증언": ["4T", true],
    "5증언": ["5T", true],
    "6증언": ["6T", true],
    "7증언": ["7T", true],
    "8증언": ["8T", true],
    "9증언": ["9T", true],
    "청지기": ["CS", true],
    "CH": ["CH", false],
    "CW": ["CW", false],
    "FE": ["FE", false],
    "ML": ["ML", false],
    "MM": ["MM", true],
    "SD": ["SD", false],
    "가정": ["AH", true],
    "교육": ["Ed", true],
    "구호": ["WM", true],
    "목사": ["TM", true],
    "문전": ["CM", true],
    "보훈": ["MB", true],
    "복음": ["GW", true],
    "부모": ["CT", true],
    "부조": ["PP", true],
    "살아": ["SR", true],
    "선교": ["ChS", true],
    "선지": ["PK", true],
    "성화": ["SL", true],
    "소망": ["DA", true],
    "실물": ["COL", true],
    "안교": ["CSW", true],
    "음식": ["CD", true],
    "자녀": ["CG", true],
    "자서": ["LS", false],
    "쟁투": ["GC", true],
    "전도": ["Ev", true],
    "절제": ["Te", true],
    "정로": ["SC", true],
    "청년": ["MYP", true],
    "초기": ["EW", true],
    "치료": ["MH", true],
    "행적": ["AA", true],
  };

  // 판본 표시 — 약칭 **앞**에 붙어 "그 판본에서는"을 뜻한다. 책을 가리지 않으므로
  // 표를 찾을 때만 떼어 내고, 화면 글자는 적힌 그대로 둔다.
  // 겹쳐 붙고 쉼표가 들어간다: "RV, marg. 부모 530" · "RV, Amer. Sup. 부조 80"
  // (전권 1,037줄 실측. 인덱스에서 쉼표가 나오는 곳은 여기와 성경 범위 머리줄뿐이다.)
  // 이음말이 쉼표·마침표·빈칸으로 제각각이고 아예 없기도 하다("Amer. Sup.쟁투 437").
  // 그래서 이음말을 *(없어도 됨)로 둔다 — 표시 자체가 앞머리에만 오므로 안전하다.
  var EDITION = /^(?:(?:ARV|RV|marg\.|var\.|Amer\.\s*Sup\.|Am\.\s*Sup\.|Leeser|Noyes|Rotherham's\s+translation)[\s,.]*)+/i;

  // 줄 하나를 푼다 → { edition, abbrev, code, koSite, page, endPage } · 못 풀면 null
  //   "소망 44"           → 44쪽
  //   "교육 128-9"        → 128~129쪽. **문단이 아니라 쪽 범위다.**
  //   "화잇주석 5권 1116"  → 약칭에 빈칸이 들어 있다 — 뒤에서부터 쪽을 떼어 낸다
  //   "RV, marg. 부모 530" → 판본을 먼저 떼고 나서 가른다. 차례를 바꾸면
  //                          "RV, marg. 부모" 가 통째로 약칭이 되어 표에서 못 찾는다.
  //
  // 뒷수가 앞수보다 자릿수가 적으면 학술 표기의 줄임꼴이다 — 앞수의 뒤를 갈아 끼운다.
  //   128-9 → 129 · 111-6 → 116 · 310-1 → 311 · 90-5 → 95
  // 자릿수가 같거나 크면 줄임이 아니라 그대로 끝쪽이다(44-51 → 44~51쪽, 실측 1,895줄).
  function endOfRange(start, tail) {
    var a = String(start), b = String(tail);
    if (b.length >= a.length) return parseInt(b, 10);
    return parseInt(a.slice(0, a.length - b.length) + b, 10);
  }

  function parse(line) {
    if (!line) return null;
    var s = String(line).replace(/\s+/g, " ").trim();
    if (!s) return null;
    var edition = "";
    var m = s.match(EDITION);
    if (m) { edition = m[0].trim().replace(/[\s,]+$/, ""); s = s.slice(m[0].length); }
    // 쪽 뒤 꼬리말("lastpart")은 전권에 한 줄뿐이나, 그 한 줄을 버릴 까닭이 없다.
    var pm = s.match(/^(.*?)\s+(\d+)(?:-(\d+))?(?:\s+[A-Za-z][A-Za-z\s]*)?$/);
    if (!pm) return null;
    var hit = BOOKS[pm[1].trim()];
    if (!hit) return null;
    var page = parseInt(pm[2], 10);
    return {
      edition: edition,
      abbrev: pm[1].trim(),
      code: hit[0],
      koSite: hit[1],                  // egwwritings 에 한글본이 있는가(바깥으로 나갈 때 쓴다)
      page: page,                      // 여는 자리는 언제나 앞쪽 하나다
      endPage: pm[3] ? endOfRange(page, pm[3]) : page
    };
  }

  // 한 칸(btext)에서 참조를 모은다.
  // 머리줄(`창 1장 전체`·`마 1:1-17`)은 성경 범위이지 화잇 저서가 아니다. <b> 안에
  // 있으므로 태그로 가린다 — 글자만 보면 수로 끝나는 것과 아닌 것이 섞여 있어
  // 걸러 내기가 어렵다(전권 31,345줄).
  function parseAll(btext) {
    if (!btext) return [];
    var plain = String(btext)
      .replace(/<b\b[^>]*>[\s\S]*?<\/b>/gi, "\n")     // 머리줄 통째로 버린다
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&");
    var out = [];
    plain.split("\n").forEach(function (ln) {
      var r = parse(ln);
      if (r) { r.raw = ln.trim(); out.push(r); }
    });
    return out;
  }

  // 코드 → 약칭. 사람에게 보일 이름이다("DA" 대신 "소망").
  // 같은 코드를 가리키는 약칭이 여럿이면 짧은 쪽을 쓴다.
  var LABEL = {};
  Object.keys(BOOKS).forEach(function (k) {
    var c = BOOKS[k][0];
    if (!LABEL[c] || k.length < LABEL[c].length) LABEL[c] = k;
  });
  // 인덱스가 부르지 않는 책 — 약호표에 없으므로 이름을 따로 적어 둔다.
  // 7A권은 성경 순서가 아니라 교리 주제로 엮여 있어 인덱스가 가리킬 수 없다.
  // 그래도 책 목록에서 펴서 읽을 수 있으므로 알아볼 이름이 있어야 한다.
  var EXTRA = { "7ABC": "화잇주석 7A권 (주제별)" };
  function codeLabel(code) { return LABEL[code] || EXTRA[code] || code; }

  // 앱 안 본문의 저장 id. 한글이 먼저다.
  function localIds(code) { return ["egw:ko_" + code, "egw:" + code]; }

  // 바깥 — EGW Writings. 쪽까지 데려다 준다.
  function externalUrl(code, page, lang) {
    var l = (lang === "en") ? "en" : "ko";
    return "https://m.egwwritings.org/" + l + "/search?query=" +
           encodeURIComponent(code + " " + page);
  }

  window.EgwLink = {
    BOOKS: BOOKS, EDITION: EDITION,
    parse: parse, parseAll: parseAll, codeLabel: codeLabel,
    localIds: localIds, externalUrl: externalUrl
  };
})();
