// 암송 단계 엔진
// 단계 1: 전체보기
// 단계 2: 부분숨김 (난수로 중요 단어 선택하여 가리기)
// 단계 3: 한글자만 (한국어: 마지막 글자, 그 외: 첫 글자, 언더바로 나머지 표시)
// 단계 4: 전체숨김 (탭으로 흐리게 → 선명하게)
// 단계 5: 그림연상 (이미지로 구절 기억)

const STEP_LABELS = ["1단계 전체보기", "2단계 부분숨김", "3단계 한글자만", "4단계 전체숨김", "5단계 그림연상"];
const MAX_STEP = 5;

// ===== 토크나이저 =====
function tokenize(text, lang) {
  if (!text) return [];
  if (["ko", "en", "in"].includes(lang)) {
    return text.split(/\s+/).filter(t => t.length > 0);
  }
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(lang, { granularity: "word" });
      return [...segmenter.segment(text)]
        .filter(s => s.isWordLike)
        .map(s => s.segment);
    } catch (e) {}
  }
  return text.split(/([，。、！？；：\s]+)/).filter(t => t.trim().length > 0);
}

// ===== 부분숨김 인덱스 계산 (순수 랜덤, 매번 다름) =====
// 짧은 단어(1~2자)를 제외하고 약 45% 무작위 선택
function computePartialHideIndices(words, lang) {
  const minLen = ["ko", "ja", "zh"].includes(lang) ? 2 : 4;
  const indices = new Set();
  words.forEach((word, i) => {
    const cleaned = word.replace(/[^a-zA-Z가-힣ぁ-んァ-ン一-龯]/g, "");
    if (cleaned.length >= minLen && Math.random() < 0.48) {
      indices.add(i);
    }
  });
  // 최소 2개 보장
  if (indices.size < 2 && words.length > 3) {
    for (let i = 0; i < words.length && indices.size < 2; i++) {
      if (!indices.has(i)) indices.add(i);
    }
  }
  return indices;
}

// ===== 단어 폭 계산 (비례) =====
function calcWordWidth(word, lang) {
  const isCJK = ["ko", "ja", "zh"].includes(lang);
  const charWidth = isCJK ? 1.0 : 0.58;
  return Math.max(1.5, word.length * charWidth) + "em";
}

// ===== 한글자만 단계용 힌트 텍스트 =====
function getHintText(word, lang) {
  if (word.length === 0) return word;
  if (lang === "ko") {
    // 한국어: 마지막 글자 표시 (어미/조사)
    const lastChar = word[word.length - 1];
    const underscores = "_".repeat(word.length - 1);
    return underscores + lastChar;
  } else {
    // 그 외: 첫 글자 표시
    const firstChar = word[0];
    const underscores = "_".repeat(word.length - 1);
    return firstChar + underscores;
  }
}

// ===== 메인 렌더링 함수 =====
// options: { partialHideIndices: Set<number>, highlights: {[wordIndex]: colorString} }
function renderWords(container, text, lang, step, wordStates, options = {}) {
  const words = tokenize(text, lang);
  container.innerHTML = "";
  if (words.length === 0) return words;

  const partialIndices = options.partialHideIndices || new Set();
  const highlights = options.highlights || {};
  const addSpaces = ["ko", "en", "in"].includes(lang);

  // ── 형광펜 색이 바뀌는 지점을 기준으로 구(Phrase) 그룹 묶기 ──
  const groups = [];
  let curColor = highlights[0] ?? "none";
  let curGroup = [0];
  for (let i = 1; i < words.length; i++) {
    const color = highlights[i] ?? "none";
    if (color === curColor) {
      curGroup.push(i);
    } else {
      groups.push(curGroup);
      curColor = color;
      curGroup = [i];
    }
  }
  groups.push(curGroup);

  // ── 그룹별 phrase-line div 렌더링 ──
  groups.forEach((groupIndices) => {
    const phraseEl = document.createElement("div");
    phraseEl.className = "phrase-line";

    groupIndices.forEach((i, gi) => {
      const word = words[i];
      const span = document.createElement("span");
      span.className = "word";
      span.dataset.index = i;

      switch (step) {
        case 1: // 전체보기
        case 5: // 그림연상 (verseArea는 app.js에서 숨김 처리)
          span.classList.add("word--visible");
          span.textContent = word;
          break;

        case 2: // 부분숨김
          if (partialIndices.has(i)) {
            const wState = (wordStates && wordStates[i]) || "hidden";
            span.classList.add("word--tappable", "word--partial-hidden");
            if (wState === "blurred") {
              span.classList.add("word--blurred");
              span.textContent = word;
            } else if (wState === "visible") {
              span.classList.remove("word--partial-hidden");
              span.classList.add("word--visible");
              span.textContent = word;
            } else {
              span.style.minWidth = calcWordWidth(word, lang);
              span.textContent = "\u00A0";
            }
          } else {
            span.classList.add("word--visible");
            span.textContent = word;
          }
          break;

        case 3: // 한글자만
          span.classList.add("word--first-only");
          span.textContent = word.length <= 1 ? word : getHintText(word, lang);
          break;

        case 4: { // 전체숨김
          span.classList.add("word--tappable");
          const wState4 = (wordStates && wordStates[i]) || "hidden";
          if (wState4 === "blurred") {
            span.classList.add("word--blurred");
            span.textContent = word;
          } else if (wState4 === "visible") {
            span.classList.add("word--visible");
            span.textContent = word;
          } else {
            span.classList.add("word--hidden");
            span.style.minWidth = calcWordWidth(word, lang);
            span.textContent = "\u00A0";
          }
          break;
        }
      }

      // 형광펜 색상 클래스 적용
      if (highlights[i]) {
        span.classList.add(`highlight--${highlights[i]}`);
      }

      phraseEl.appendChild(span);

      // 단어 사이 공백 (그룹 내, CJK 제외, 그룹 마지막 단어 제외)
      if (addSpaces && gi < groupIndices.length - 1) {
        phraseEl.appendChild(document.createTextNode(" "));
      }
    });

    container.appendChild(phraseEl);
  });

  return words;
}

// ===== 단어 탭 핸들러 (2단계 부분숨김, 4단계 전체숨김 공통) =====
function handleWordTap(e, words, wordStates) {
  const span = e.target.closest(".word--tappable");
  if (!span) return false;

  const idx = parseInt(span.dataset.index);
  if (isNaN(idx) || idx >= words.length) return false;

  const currentState = wordStates[idx] || "hidden";
  const word = words[idx];
  const isPartial = span.classList.contains("word--partial-hidden");

  if (currentState === "hidden") {
    // hidden → blurred : CSS transition을 우회하여 즉시 blur 적용
    wordStates[idx] = "blurred";
    span.classList.remove("word--hidden");
    span.style.minWidth = "";
    span.textContent = word;
    span.style.transition = "none";      // transition 차단
    void span.offsetWidth;               // reflow (차단 즉시 적용)
    span.classList.add("word--blurred");
    void span.offsetWidth;               // reflow (blur 즉시 적용)
    span.style.transition = "";          // transition 복원 (이후 변화는 부드럽게)
  } else if (currentState === "blurred") {
    // blurred → visible (smooth transition)
    wordStates[idx] = "visible";
    span.classList.remove("word--blurred", "word--partial-hidden");
    span.classList.add("word--visible");
  } else {
    // visible → hidden 다시 순환
    wordStates[idx] = "hidden";
    span.classList.remove("word--visible");
    if (isPartial) {
      // 부분숨김 단어: word--partial-hidden 복원 (gray box)
      span.classList.add("word--partial-hidden");
    } else {
      // 전체숨김 단어: word--hidden 추가
      span.classList.add("word--hidden");
    }
    const lang = span.closest(".verse-column.primary") ? "ko" : "en";
    span.style.minWidth = calcWordWidth(word, lang);
    span.textContent = "\u00A0";
  }

  return true;
}
