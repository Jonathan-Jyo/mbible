// 관주(교차참조) 패널
// · data-gwanju.js 를 최초 사용 시 지연 로딩
// · 주 성경절의 각 절 하단에 해당 관주 성경절을 작은 글씨·들여쓰기로 표시
// · 기본: 관주 주소만 / 탭하면 본문 펼침 (접기·펼치기 토글)
const GwanjuManager = (() => {
  let _loading = null;

  // ── 데이터 지연 로딩 ──
  function ensureData() {
    if (window.GWANJU) return Promise.resolve(true);
    if (_loading) return _loading;
    _loading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "js/data-gwanju.js?v=1";
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return _loading;
  }

  // ── 참조 문자열 → {book, chap, verses[]} ──
  // 예) "딤후3:16,17" → book:"딤후" chap:"3" verses:[16,17]
  //     "겔36:25-27" → 25,26,27   "계22;18,19"(오타) → 18,19
  function expandRef(ref) {
    if (!ref) return null;
    const s = ref.replace(/\s/g, "").replace(/;/g, ":");
    const m = s.match(/^(\D.*?)(\d+):(.+)$/);
    if (!m) return null;
    const book = m[1], chap = m[2], vpart = m[3];
    const verses = [];
    vpart.split(",").forEach((tok) => {
      tok = tok.trim();
      if (!tok) return;
      const rng = tok.match(/^(\d+)-(\d+)$/);
      if (rng) {
        const a = +rng[1], b = +rng[2];
        if (b >= a && b - a < 200) for (let v = a; v <= b; v++) verses.push(v);
      } else {
        const mm = tok.match(/^(\d+)/);
        if (mm) verses.push(+mm[1]);
      }
    });
    return { book, chap, verses };
  }

  // ── 렌더링 ──
  // container: 관주 패널이 들어갈 요소,  referenceKo: 예) "딤후3:16,17"
  async function render(container, referenceKo) {
    if (!container) return;
    const parsed = expandRef(referenceKo);
    if (!parsed || !parsed.verses.length) {
      container.classList.add("hidden");
      container.innerHTML = "";
      return;
    }

    const ok = await ensureData();
    if (!ok || !window.GWANJU) {
      container.classList.add("hidden");
      return;
    }

    // 절별 관주 수집
    const perVerse = parsed.verses.map((v) => {
      const key = `${parsed.book}${parsed.chap}:${v}`;
      return { v, refs: window.GWANJU[key] || [] };
    });
    const total = perVerse.reduce((n, x) => n + x.refs.length, 0);
    if (total === 0) {
      container.classList.add("hidden");
      container.innerHTML = "";
      return;
    }

    container.classList.remove("hidden");
    container.innerHTML = "";

    // 마스터 토글 버튼
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "gwanju-toggle";
    toggle.innerHTML = `<span class="gwanju-icon">🔗</span> 관주 <span class="gwanju-count">${total}</span>`;
    container.appendChild(toggle);

    // 본문 영역 (기본 접힘)
    const body = document.createElement("div");
    body.className = "gwanju-body hidden";
    container.appendChild(body);

    perVerse.forEach(({ v, refs }) => {
      if (!refs.length) return;
      const block = document.createElement("div");
      block.className = "gwanju-verse";

      const head = document.createElement("button");
      head.type = "button";
      head.className = "gwanju-vhead";
      const addrs = refs.map((x) => `<span class="gwanju-addr">${x.r}</span>`).join("");
      head.innerHTML =
        `<span class="gwanju-vnum">${v}절</span>` +
        `<span class="gwanju-addrs">${addrs}</span>` +
        `<span class="gwanju-caret">▸</span>`;
      block.appendChild(head);

      const texts = document.createElement("div");
      texts.className = "gwanju-texts hidden";
      refs.forEach((x) => {
        const row = document.createElement("div");
        row.className = "gwanju-text";
        row.innerHTML = `<b class="gwanju-tref">${x.r}</b> <span class="gwanju-tbody">${x.t}</span>`;
        texts.appendChild(row);
      });
      block.appendChild(texts);

      head.addEventListener("click", () => {
        const open = texts.classList.toggle("hidden");
        head.classList.toggle("open", !open);
      });

      body.appendChild(block);
    });

    toggle.addEventListener("click", () => {
      const open = body.classList.toggle("hidden");
      toggle.classList.toggle("open", !open);
    });
  }

  return { render, expandRef };
})();
