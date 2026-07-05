// ============================================================================
// BibleDB - 베들레헴 성경 로컬 번들(data/bible-db/*.json)에서
//           장절 참조 하나로 7개 번역본(5개 언어)을 즉시 조회한다.
// ----------------------------------------------------------------------------
// · 네트워크: 책 1권(JSON) fetch만 발생, 이후 Service Worker가 캐시 → 오프라인 동작
// · 범위 참조 지원: "요 3:16-17", "요 3:16~17"
// ============================================================================

const BibleDB = (() => {
  const DATA_DIR = "data/bible-db";

  // ── 한국어 약어 → USFM 코드 (표준 66권 순서와 동일하게 유지) ──
  const KO_BOOK_MAP = {
    '창':'GEN','출':'EXO','레':'LEV','민':'NUM','신':'DEU','수':'JOS','삿':'JDG','룻':'RUT',
    '삼상':'1SA','삼하':'2SA','왕상':'1KI','왕하':'2KI','대상':'1CH','대하':'2CH',
    '스':'EZR','느':'NEH','에':'EST','욥':'JOB','시':'PSA','잠':'PRO','전':'ECC','아':'SNG',
    '사':'ISA','렘':'JER','애':'LAM','겔':'EZK','단':'DAN','호':'HOS','욜':'JOL',
    '암':'AMO','옵':'OBA','욘':'JON','미':'MIC','나':'NAM','합':'HAB','습':'ZEP',
    '학':'HAG','슥':'ZEC','말':'MAL',
    '마':'MAT','막':'MRK','눅':'LUK','요':'JHN','행':'ACT','롬':'ROM',
    '고전':'1CO','고후':'2CO','갈':'GAL','엡':'EPH','빌':'PHP','골':'COL',
    '살전':'1TH','살후':'2TH','딤전':'1TI','딤후':'2TI','딛':'TIT','몬':'PHM',
    '히':'HEB','약':'JAS','벧전':'1PE','벧후':'2PE','요일':'1JN','요이':'2JN',
    '요삼':'3JN','유':'JUD','계':'REV'
  };
  const USFM_TO_KO = Object.fromEntries(Object.entries(KO_BOOK_MAP).map(([ko, usfm]) => [usfm, ko]));

  const BOOK_ORDER = [
    "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA",
    "1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO",
    "ECC","SNG","ISA","JER","LAM","EZK","DAN","HOS","JOL","AMO",
    "OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL",
    "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH",
    "PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS",
    "1PE","2PE","1JN","2JN","3JN","JUD","REV",
  ];
  const BOOK_NUM = Object.fromEntries(BOOK_ORDER.map((code, i) => [code, i + 1]));

  const _bookCache = {}; // { [bookNum]: Promise<bookJson> }

  // ── 참조 문자열 파싱: "요 3:16-17" / "요 3:16~17" / "요 3:16" / "JHN.3.16-17" ──
  function parseRef(raw) {
    raw = (raw || "").trim();
    if (!raw) return null;

    // USFM 직접 입력: JHN.3.16 또는 JHN.3.16-17
    let m = /^([1-3A-Z]{2,4})\.(\d+)\.(\d+)(?:[-~](\d+))?$/.exec(raw);
    if (m) {
      const [, code, chapter, start, end] = m;
      if (!BOOK_NUM[code]) return null;
      return { code, chapter: +chapter, start: +start, end: end ? +end : +start };
    }

    // 한국어 약어: 긴 약어 우선 매칭
    const sorted = Object.keys(KO_BOOK_MAP).sort((a, b) => b.length - a.length);
    for (const abbr of sorted) {
      if (!raw.startsWith(abbr)) continue;
      const rest = raw.slice(abbr.length).trim();
      const rm = /^(\d+)\s*[:：]\s*(\d+)(?:\s*[-~]\s*(\d+))?/.exec(rest);
      if (rm) {
        const [, chapter, start, end] = rm;
        return { code: KO_BOOK_MAP[abbr], chapter: +chapter, start: +start, end: end ? +end : +start };
      }
    }
    return null;
  }

  async function fetchBook(bookNum) {
    if (!_bookCache[bookNum]) {
      const path = `${DATA_DIR}/${String(bookNum).padStart(2, "0")}.json`;
      _bookCache[bookNum] = fetch(path).then(res => {
        if (!res.ok) throw new Error(`성경 데이터 로드 실패 (${res.status}): ${path}`);
        return res.json();
      }).catch(err => {
        delete _bookCache[bookNum]; // 실패 시 재시도 가능하도록 캐시 제거
        throw err;
      });
    }
    return _bookCache[bookNum];
  }

  function refDisplay(abbrCode, chapter, start, end) {
    const range = end > start ? `${start}-${end}` : `${start}`;
    return `${abbrCode} ${chapter}:${range}`;
  }

  // ── 언어 슬롯별 버전 선택 결과를 받아 조회 ──
  // versionChoice 예: { ko: "ko_gae", en: "en_nkjv" }  (ja/zh/in은 버전이 하나뿐이라 고정)
  async function lookup(raw, versionChoice) {
    const parsed = parseRef(raw);
    if (!parsed) throw new Error("참조 형식을 인식할 수 없습니다. (예: 요 3:16 또는 요 3:16-17)");

    const { code, chapter, start, end } = parsed;
    const bookNum = BOOK_NUM[code];
    const book = await fetchBook(bookNum);

    const koVer = (versionChoice && versionChoice.ko) || "ko_gae";
    const enVer = (versionChoice && versionChoice.en) || "en_nkjv";
    const zhVer = (versionChoice && versionChoice.zh) || "zh";  // "zh"=간체, "zh_trad"=번체
    const versionMap = { ko: koVer, en: enVer, ja: "ja", zh: zhVer, in: "in" };

    const verses = {}, refs = {};
    for (const lang of ["ko", "en", "ja", "zh", "in"]) {
      const vkey = versionMap[lang];
      const parts = [];
      for (let v = start; v <= end; v++) {
        const cell = book.verses[`${chapter}.${v}`];
        if (cell && cell[vkey]) parts.push(cell[vkey]);
      }
      if (parts.length) {
        verses[lang] = parts.join(" ");
        refs[lang] = lang === "ko"
          ? refDisplay(USFM_TO_KO[code] || code, chapter, start, end)
          : refDisplay(code, chapter, start, end);
      }
    }

    if (!verses.ko) {
      throw new Error(`선택한 번역본에서 ${refDisplay(code, chapter, start, end)} 구절을 찾을 수 없습니다.`);
    }

    return { verses, refs, book: bookNum, abbr: code, chapter, start, end };
  }

  return { parseRef, lookup, fetchBook, KO_BOOK_MAP, BOOK_NUM };
})();
