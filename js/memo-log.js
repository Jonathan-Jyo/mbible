// 암송 완료 횟수 기록 (localStorage)
// 키: "bible-memo-log"  값: { "quarter|lesson": { count, lastChecked } }
const MemoLog = {
  KEY: "bible-memo-log",

  _key(quarter, lesson) { return `${quarter}|${lesson}`; },

  _load() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || "{}"); }
    catch(e) { return {}; }
  },

  _save(data) {
    localStorage.setItem(this.KEY, JSON.stringify(data));
  },

  get(quarter, lesson) {
    const data = this._load();
    return data[this._key(quarter, lesson)] || { count: 0, lastChecked: null };
  },

  increment(quarter, lesson) {
    const data = this._load();
    const k    = this._key(quarter, lesson);
    if (!data[k]) data[k] = { count: 0, lastChecked: null };
    data[k].count++;
    data[k].lastChecked = Date.now();
    this._save(data);
    return data[k].count;
  },

  decrement(quarter, lesson) {
    const data = this._load();
    const k    = this._key(quarter, lesson);
    if (!data[k] || data[k].count <= 0) return 0;
    data[k].count--;
    if (data[k].count === 0) {
      delete data[k];
      this._save(data);
      return 0;
    }
    this._save(data);
    return data[k].count;
  },

  reset(quarter, lesson) {
    const data = this._load();
    const k = this._key(quarter, lesson);
    delete data[k];
    this._save(data);
    return 0;
  },

  getAll()        { return this._load(); },
  saveAll(data)   { this._save(data); },

  // 통계: 전체 절수, 한번이라도 체크한 수, 5회 이상 숙달한 수
  statsFor(quarter, lessons) {
    const data  = this._load();
    const total = lessons.length;
    let checked = 0, proficient = 0;
    lessons.forEach(l => {
      const k   = this._key(quarter, l.lesson);
      const cnt = (data[k] || {}).count || 0;
      if (cnt >= 1) checked++;
      if (cnt >= 5) proficient++;
    });
    return { total, checked, proficient };
  }
};
