// 즐겨찾기 관리 (localStorage CRUD)
const FavoritesManager = {
  KEY: "bible-favorites",

  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || "[]"); }
    catch(e) { return []; }
  },

  save(arr) {
    localStorage.setItem(this.KEY, JSON.stringify(arr));
  },

  isFavorite(quarter, lesson) {
    return this.load().some(f => f.quarter === quarter && f.lesson === lesson);
  },

  // lessonData: 현재 lessonData 객체 (스냅샷으로 저장)
  toggle(quarter, lesson, lessonData) {
    const arr = this.load();
    const idx = arr.findIndex(f => f.quarter === quarter && f.lesson === lesson);
    if (idx >= 0) {
      arr.splice(idx, 1);
      this.save(arr);
      return false; // 제거됨
    } else {
      arr.push({ quarter, lesson, data: { ...lessonData } });
      this.save(arr);
      return true; // 추가됨
    }
  },

  // 즐겨찾기 분기용 VERSES 객체 생성
  buildVERSES() {
    const favs = this.load();
    return {
      theme: {
        navBg:       "#1a1530",
        footerBg:    "#1a1530",
        chFrom:      "#3a2060",
        chTo:        "#1a1530",
        accent:      "#e6b84a",
        accentText:  "#1a1a0a",
        accentWhite: "#c9a84c"
      },
      title: "즐겨찾기",
      lessons: favs.map((f, i) => ({
        ...f.data,
        lesson: i + 1,
        _srcQuarter: f.quarter,
        _srcLesson:  f.lesson
      }))
    };
  }
};
