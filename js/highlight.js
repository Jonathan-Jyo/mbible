// 형광펜 기능 - localStorage에 영구 저장
const HighlightManager = {
  active: false,
  currentColor: "yellow",
  data: {},

  init() {
    this.load();
  },

  getKey(quarter, lesson, lang) {
    return `${quarter}-${lesson}-${lang}`;
  },

  load() {
    try {
      const saved = localStorage.getItem("bible-memory-highlights");
      if (saved) this.data = JSON.parse(saved);
    } catch (e) {
      this.data = {};
    }
  },

  save() {
    try {
      localStorage.setItem("bible-memory-highlights", JSON.stringify(this.data));
    } catch (e) {}
  },

  toggle() {
    this.active = !this.active;
    return this.active;
  },

  setColor(color) {
    this.currentColor = color;
  },

  applyToWord(quarter, lesson, lang, wordIndex) {
    const key = this.getKey(quarter, lesson, lang);
    if (!this.data[key]) this.data[key] = {};

    if (this.currentColor === "none") {
      delete this.data[key][wordIndex];
    } else {
      const existing = this.data[key][wordIndex];
      // 같은 색이면 토글 해제, 다른 색이면 교체
      if (existing === this.currentColor) {
        delete this.data[key][wordIndex];
      } else {
        this.data[key][wordIndex] = this.currentColor;
      }
    }
    this.save();
  },

  getHighlights(quarter, lesson, lang) {
    const key = this.getKey(quarter, lesson, lang);
    return this.data[key] || {};
  },

  // 현재 과/언어의 하이라이트를 DOM에 적용 (모든 단계에서 호출)
  applyHighlightsToDOM(container, quarter, lesson, lang) {
    const highlights = this.getHighlights(quarter, lesson, lang);
    const words = container.querySelectorAll(".word");
    words.forEach((word, i) => {
      word.classList.remove("highlight--yellow", "highlight--green", "highlight--pink", "highlight--blue", "highlight--orange", "highlight--purple", "highlight--custom");
      if (highlights[i]) {
        word.classList.add(`highlight--${highlights[i]}`);
      }
    });
  },

  // 현재 과/언어의 전체 하이라이트 삭제
  clearAll(quarter, lesson, lang) {
    const key = this.getKey(quarter, lesson, lang);
    delete this.data[key];
    this.save();
  },

  // 현재 과 모든 언어 하이라이트 삭제
  clearAllLangs(quarter, lesson) {
    Object.keys(this.data).forEach(key => {
      if (key.startsWith(`${quarter}-${lesson}-`)) {
        delete this.data[key];
      }
    });
    this.save();
  }
};
