// 성경절 데이터 로더
// 연도별 파일(data-2026.js 등)을 필요할 때만 동적으로 로드

const LANGUAGES = {
  ko: { name: "한국어", flag: "🇰🇷" },
  en: { name: "English", flag: "🇺🇸" },
  ja: { name: "日本語", flag: "🇯🇵" },
  zh: { name: "中文", flag: "🇨🇳" },
  in: { name: "Indonesian", flag: "🇮🇩" }
};

// 전체 기억절 저장소 (동적으로 채워짐)
const VERSES = {};

const DataLoader = {
  loaded: {},  // { "2026": true, ... }

  // quarter 예: "2026-02" → "2026", "yeongyeol" → "yeongyeol"
  getYear(quarter) {
    if (!quarter.includes("-")) return quarter;
    return quarter.split("-")[0];
  },

  // 해당 연도 데이터 파일을 동적으로 로드 후 VERSES에 병합
  load(year) {
    if (this.loaded[year]) return Promise.resolve(true);
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = `js/data-${year}.js`;
      script.onload = async () => {
        const yearData = window[`VERSES_${year}`];
        if (yearData) {
          Object.assign(VERSES, yearData);
          // ModuleManager 자동 마이그레이션 (최초 로드 시 레지스트리 등록)
          if (typeof ModuleManager !== "undefined") {
            for (const [quarterKey, data] of Object.entries(yearData)) {
              await ModuleManager.migrateFromLegacy(quarterKey, data);
            }
          }
        }
        this.loaded[year] = true;
        resolve(true);
      };
      script.onerror = () => {
        console.warn(`데이터 파일 로드 실패: data-${year}.js`);
        resolve(false);
      };
      document.head.appendChild(script);
    });
  },

  // ── 커스텀 모듈 (IndexedDB) → VERSES 로드 ───────────────────
  // 모듈 빌더로 만든 모듈, 외부 .module.json 설치 모듈에 사용
  // type !== "quarterly" 인 모듈은 모두 이 경로로 로드
  async loadInstalledModule(moduleId) {
    if (VERSES[moduleId]) return true;   // 이미 로드됨
    if (typeof ModuleManager === "undefined") return false;
    try {
      const data = await ModuleManager.getModuleData(moduleId);
      if (!data) {
        console.warn(`커스텀 모듈 데이터 없음: ${moduleId}`);
        return false;
      }
      // data 구조: { theme, title, lessons }
      VERSES[moduleId] = data;
      return true;
    } catch (e) {
      console.error(`커스텀 모듈 로드 오류 (${moduleId}):`, e);
      return false;
    }
  }
};
