// 사용자 성경절 관리 (localStorage CRUD)
const UserVerseManager = {
  KEY: "bible-user-verses",

  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || "[]"); }
    catch(e) { return []; }
  },

  save(arr) {
    localStorage.setItem(this.KEY, JSON.stringify(arr));
  },

  add(data) {
    const arr = this.load();
    const verse = {
      id: `uv-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      topic:     data.topic     || "",
      lang:      data.lang      || "ko",
      reference: data.reference || "",
      verse:     data.verse     || "",
      multilang: data.multilang || false,
      verses:    data.verses    || null,
      refs:      data.refs      || null,
      titles:    data.titles    || null,
      hasAudio:  false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    arr.push(verse);
    this.save(arr);
    return verse;
  },

  update(id, data) {
    const arr = this.load();
    const i = arr.findIndex(v => v.id === id);
    if (i < 0) return false;
    Object.assign(arr[i], data, { updatedAt: Date.now() });
    this.save(arr);
    return arr[i];
  },

  delete(id) {
    const arr = this.load().filter(v => v.id !== id);
    this.save(arr);
  },

  getSorted(order = "alpha") {
    const arr = this.load().slice();
    if (order === "recent") {
      return arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    return arr.sort((a, b) => a.topic.localeCompare(b.topic, "ko"));
  },

  // VERSES["user"] 형태로 변환 (app.js 통합용)
  buildVERSES(order = "alpha") {
    const sorted = this.getSorted(order);
    const hasMultilang = sorted.some(v => v.multilang && v.verses);
    return {
      theme: {
        navBg:       "#1b2a1f", footerBg:   "#1b2a1f",
        chFrom:      "#2d4f35", chTo:        "#1b2a1f",
        accent:      "#7dbf7d", accentText:  "#0a1a0d",
        accentWhite: "#4a9c5a"
      },
      koOnly: !hasMultilang,
      title: "사용자 성경절",
      lessons: sorted.map((v, i) => {
        let fill, ref;
        if (v.multilang && v.verses) {
          fill = {
            ko: v.verses.ko || v.verse,
            en: v.verses.en || v.verse,
            ja: v.verses.ja || v.verse,
            zh: v.verses.zh || v.verse,
            in: v.verses.in || v.verse
          };
          ref = {
            ko: v.refs?.ko || v.reference,
            en: v.refs?.en || v.reference,
            ja: v.refs?.ja || v.reference,
            zh: v.refs?.zh || v.reference,
            in: v.refs?.in || v.reference
          };
        } else {
          fill = { ko: v.verse, en: v.verse, ja: v.verse, zh: v.verse, in: v.verse };
          ref  = { ko: v.reference, en: v.reference, ja: v.reference, zh: v.reference, in: v.reference };
        }
        return {
          lesson:    i + 1,
          badgeText: v.topic,
          _id:       v.id,
          _lang:     v.lang,
          title:     {
            ko: v.titles?.ko || v.topic,
            en: v.titles?.en || v.topic,
            ja: v.titles?.ja || v.topic,
            zh: v.titles?.zh || v.topic,
            in: v.titles?.in || v.topic
          },
          verse:     fill,
          reference: ref,
          audio:     v.hasAudio ? `user:${v.id}` : null
        };
      })
    };
  }
};
