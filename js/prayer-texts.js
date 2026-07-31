// ============================================================================
// PrayerTextManager — 기도문 모음 (평화의 기도·유명 기도문 등을 담아 두고 읽는 곳)
// ----------------------------------------------------------------------------
// 개인 기도제목(PrayStore)과는 다르다 — 이건 "누가 쓴 기도문을 그대로 옮겨
// 담아 두고 필요할 때 읽거나 나누는" 용도. 그래서 필드도 다르다:
//   제목(title) · 작성자(author) · 내용(content, 기도문 본문) · 설명(description)
// ============================================================================
const PrayerTextManager = {
  KEY: "bible-prayer-texts",

  load() {
    try { const v = JSON.parse(localStorage.getItem(this.KEY) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  },
  save(arr) { localStorage.setItem(this.KEY, JSON.stringify(arr)); },

  add(data) {
    const arr = this.load();
    const item = {
      id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title:       (data.title || "").trim(),
      author:      (data.author || "").trim(),
      content:     data.content || "",
      description: data.description || "",
      createdAt: Date.now(), updatedAt: Date.now()
    };
    arr.push(item);
    this.save(arr);
    return item;
  },

  update(id, data) {
    const arr = this.load();
    const i = arr.findIndex(x => x.id === id);
    if (i < 0) return null;
    arr[i] = Object.assign({}, arr[i], data, { updatedAt: Date.now() });
    this.save(arr);
    return arr[i];
  },

  remove(id) { this.save(this.load().filter(x => x.id !== id)); },

  getSorted() {
    // 오래된(먼저 담은) 것부터 — 기도문은 목록이 짧고, 순서가 자연스레 담은 차례라 알아보기 쉽다
    return this.load().slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
};
