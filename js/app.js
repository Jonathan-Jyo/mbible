// 성경절 암송 앱 - 메인
(function () {
  "use strict";

  const FONT_MIN = 13;
  const FONT_MAX = 28;
  const FONT_STEP = 2;

  // ===== 상태 =====
  const state = {
    quarter: "2026-02",
    lesson: 1,
    primaryLang: "ko",
    secondaryLang: "en",
    tertiaryLang: "ja",
    dualMode: false,
    tertiaryMode: false,
    step: 1,
    showAll: false,
    fontSize: 19,
    wordStatesPrimary: {},
    wordStatesSecondary: {},
    wordStatesTertiary: {},
    primaryWords: [],
    secondaryWords: [],
    tertiaryWords: [],
    partialIndicesPrimary: new Set(),
    partialIndicesSecondary: new Set(),
    partialIndicesTertiary: new Set()
  };

  // ===== DOM =====
  const $ = (sel) => document.querySelector(sel);
  const quarterSelect     = $("#quarter-select");
  const lessonSelect      = $("#lesson-select");
  const lessonBadge       = $("#lesson-badge");
  const lessonTitle       = $("#lesson-title");
  const cardBody          = $("#card-body");
  const step2Hint         = $("#step2-hint");
  const verseArea         = $("#verse-area");
  const versePrimary      = $("#verse-primary");
  const verseSecondary    = $("#verse-secondary");
  const verseTertiary     = $("#verse-tertiary");
  const verseRef          = $("#verse-ref");
  const verseRefSecondary = $("#verse-ref-secondary");
  const verseRefTertiary  = $("#verse-ref-tertiary");
  const verseRefsBar      = $("#verse-refs-bar");
  const stepLabel         = $("#step-label");
  const stepDots          = $("#step-dots");
  const primaryLangSel    = $("#primary-lang");
  const secondaryLangSel  = $("#secondary-lang");
  const tertiaryLangSel   = $("#tertiary-lang");
  const dualToggle        = $("#dual-toggle");
  const tertiaryToggle    = $("#tertiary-toggle");
  const highlightPalette  = $("#highlight-palette");
  const card              = $("#card");
  const showAllBtn        = $("#show-all-btn");
  const refreshBtn        = $("#refresh-partial");
  const memoCheckBtn      = $("#memo-check-btn");
  const favBtn            = $("#fav-btn");
  const imgBtn            = $("#img-btn");
  const imgPanel          = $("#img-panel");
  const verseImageArea    = $("#verse-image-area");
  const verseImageEl      = $("#verse-image");

  // ===== 사용자 프로필 =====
  const UserProfile = {
    KEY: "bible-user-profile",
    load() {
      try { return JSON.parse(localStorage.getItem(this.KEY) || "{}"); }
      catch(e) { return {}; }
    },
    save(data) { localStorage.setItem(this.KEY, JSON.stringify(data)); }
  };

  // ===== 초기화 =====
  async function init() {
    loadState();
    applyFontSize();
    updateFontSizeLabel();
    // 저장된 폰트 적용
    const savedFont = localStorage.getItem("bible-font") || "system";
    applyFont(savedFont);
    HighlightManager.init();
    AudioManager.init();
    // ModuleManager IndexedDB 초기화 (데이터 로드 전)
    await ModuleManager.init();
    rebuildUserVerses();
    migrateMemoLog();         // 기존 "user|X" → "uv-id|1" 마이그레이션
    migrateFavorites();       // 기존 { quarter:"user", lesson:X } → { quarter:"uv-id", lesson:1 } 마이그레이션
    migrateUserHighlights();  // 기존 "user-X-lang" → "uv-id-1-lang" 마이그레이션
    rebuildFavorites();
    // 현재 선택된 분기 초기 로드 (커스텀 모듈이면 IndexedDB에서)
    const _initMod = ModuleManager.getModule(state.quarter);
    if (_initMod && _initMod.type !== "quarterly") {
      await DataLoader.loadInstalledModule(state.quarter);
    } else if (state.quarter !== "user" && state.quarter !== "favorites") {
      await DataLoader.load(DataLoader.getYear(state.quarter));
    }
    // 레지스트리의 모든 모듈 로드 (내장 JS + 커스텀 IndexedDB 통합)
    await _loadAllBuiltinData();
    rebuildQuarterSelect();   // Registry 기반 드롭다운 동적 생성
    applyTheme();
    bindEvents();
    bindUserPanelEvents();
    bindSearchEvents();
    bindProfileEvents();
    bindAudioPanelEvents();
    bindImagePanelEvents();
    bindModuleEvents();
    render();
    showSplash();
  }

  // ===== 상태 저장/로드 =====
  function saveState() {
    try {
      localStorage.setItem("bible-memory-state", JSON.stringify({
        quarter: state.quarter,
        lesson: state.lesson,
        primaryLang: state.primaryLang,
        secondaryLang: state.secondaryLang,
        tertiaryLang: state.tertiaryLang,
        dualMode: state.dualMode,
        tertiaryMode: state.tertiaryMode,
        step: state.step,
        fontSize: state.fontSize
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      const saved = localStorage.getItem("bible-memory-state");
      if (saved) Object.assign(state, JSON.parse(saved));
    } catch (e) {}
    const savedFont = localStorage.getItem("bible-font-size");
    if (savedFont) state.fontSize = parseInt(savedFont) || 19;
  }

  function applyFontSize() {
    document.documentElement.style.setProperty("--verse-font-size", state.fontSize + "px");
  }

  // ── 데이터 전체 로드 (앱 시작 시 1회) ─────────────────────────
  // · type === "quarterly" 내장 모듈 → JS 파일(data-{year}.js)
  // · type !== "quarterly" 커스텀 모듈 → IndexedDB(loadInstalledModule)
  async function _loadAllBuiltinData() {
    const reg    = ModuleManager.getRegistry();
    const years  = new Set(["2026", "yeongyeol"]); // 항상 내장 파일 로드

    for (const [id, mod] of Object.entries(reg.modules || {})) {
      if (mod.type === "quarterly") {
        // 내장 분기별 모듈 — 연도 JS 파일로 로드
        years.add(DataLoader.getYear(id));
      } else if (mod.status === "installed") {
        // 커스텀 모듈(topic / custom 등) — IndexedDB 에서 VERSES 로 로드
        await DataLoader.loadInstalledModule(id);
      }
    }

    for (const y of years) {
      if (!DataLoader.loaded[y]) await DataLoader.load(y);
    }
  }

  // ===== 대분류 이름 조회 (Registry 기반) =====
  const PERMANENT_NAMES = {
    favorites : "⭐ 즐겨찾기",
    yeongyeol : "연결식 성경절",
    user      : "사용자 성경절"
  };

  function getQuarterName(quarter) {
    if (PERMANENT_NAMES[quarter]) return PERMANENT_NAMES[quarter];
    const mod = ModuleManager.getModule(quarter);
    // customName(사용자 수정) → shortName(자동 생성) 순으로 우선
    return mod ? (mod.customName || mod.shortName || quarter) : quarter;
  }

  // 모듈 표시 이름 헬퍼 (카드·토스트 등 공통 사용)
  function _modName(mod) {
    if (!mod) return "";
    return mod.customName || PERMANENT_NAMES[mod.moduleId] || mod.shortName || mod.moduleId;
  }

  // ===== 대분류 드롭다운 동적 빌드 =====
  function rebuildQuarterSelect() {
    const prev = quarterSelect.value || state.quarter;
    quarterSelect.innerHTML = "";

    // 1. 즐겨찾기 (항상 최상단)
    _addOption(quarterSelect, "favorites", "⭐ 즐겨찾기");

    // 2. 설치된 모듈 (Registry 기반, sortOrder 순)
    //    favorites / user 는 하드코딩 항목과 중복되므로 제외
    const installed = ModuleManager.getInstalledModules()
      .filter(m => m.moduleId !== "favorites" && m.moduleId !== "user");
    if (installed.length > 0) {
      const grp = document.createElement("optgroup");
      grp.label = "─────────────";
      quarterSelect.appendChild(grp);
      installed.forEach(mod => {
        const label = PERMANENT_NAMES[mod.moduleId] || mod.customName || mod.shortName || mod.moduleId;
        _addOption(quarterSelect, mod.moduleId, label);
      });
    }

    // 3. 하단 고정: 사용자 성경절
    const grp2 = document.createElement("optgroup");
    grp2.label = "─────────────";
    quarterSelect.appendChild(grp2);
    _addOption(quarterSelect, "user", "사용자 성경절");

    // 이전 선택 복원 (없으면 첫 항목)
    quarterSelect.value = prev;
    if (!quarterSelect.value) {
      quarterSelect.selectedIndex = 0;
      state.quarter = quarterSelect.value;
    }
  }

  function _addOption(select, value, text) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    select.appendChild(opt);
  }

  // ===== 테마 적용 =====
  function applyTheme() {
    const data = VERSES[state.quarter];
    if (!data || !data.theme) return;
    const t = data.theme;
    const root = document.documentElement;
    root.style.setProperty("--theme-nav-bg",      t.navBg);
    root.style.setProperty("--theme-footer-bg",   t.footerBg);
    root.style.setProperty("--theme-ch-from",     t.chFrom);
    root.style.setProperty("--theme-ch-to",       t.chTo);
    root.style.setProperty("--theme-accent",      t.accent);
    root.style.setProperty("--theme-accent-text", t.accentText);
    root.style.setProperty("--theme-accent-white",t.accentWhite);
  }

  // ===== 이벤트 바인딩 =====
  function bindEvents() {
    quarterSelect.value = state.quarter;
    quarterSelect.addEventListener("change", async (e) => {
      state.quarter = e.target.value;
      state.lesson = 1;
      state.step = 1;
      state.showAll = false;
      resetWordStates();
      AudioManager.stop();
      if (state.quarter === "user") {
        rebuildUserVerses();
      } else if (state.quarter === "favorites") {
        rebuildFavorites();
      } else {
        // 커스텀 모듈(topic/custom)은 IndexedDB에서 로드, 내장 분기 모듈은 JS 파일에서 로드
        const _mod = ModuleManager.getModule(state.quarter);
        if (_mod && _mod.type !== "quarterly") {
          await DataLoader.loadInstalledModule(state.quarter);
        } else {
          await DataLoader.load(DataLoader.getYear(state.quarter));
        }
      }
      applyTheme();
      render();
      saveState();
    });

    lessonSelect.addEventListener("change", (e) => {
      state.lesson = parseInt(e.target.value);
      state.step = 1;
      state.showAll = false;
      resetWordStates();
      AudioManager.stop();
      render();
      saveState();
    });

    $("#lesson-prev").addEventListener("click", () => navigateLesson(-1));
    $("#lesson-next").addEventListener("click", () => navigateLesson(1));
    $("#step-prev").addEventListener("click",   () => navigateStep(-1));
    $("#step-next").addEventListener("click",   () => navigateStep(1));

    stepDots.addEventListener("click", (e) => {
      const dot = e.target.closest(".dot");
      if (dot) goToStep(parseInt(dot.dataset.step));
    });

    // 암송 체크 버튼
    // 짧게 탭 → +1 / 길게 누름(600ms) → −1 (실수 수정용)
    let _memoTimer = null;
    let _memoLongFired = false;

    memoCheckBtn.addEventListener("pointerdown", () => {
      _memoLongFired = false;
      _memoTimer = setTimeout(() => {
        _memoLongFired = true;
        const data = VERSES[state.quarter];
        if (!data || data.lessons.length === 0) return;
        const { q: mQ0, l: mL0 } = _hlRef(state.quarter, state.lesson);
        MemoLog.decrement(mQ0, mL0);
        renderMemoCheck();
        if (navigator.vibrate) navigator.vibrate(40);
        // −1 피드백 애니메이션
        memoCheckBtn.style.animation = "none";
        requestAnimationFrame(() => {
          memoCheckBtn.style.animation = "checkPop 0.3s ease";
        });
      }, 600);
    });

    memoCheckBtn.addEventListener("pointerup", () => {
      if (_memoTimer) { clearTimeout(_memoTimer); _memoTimer = null; }
      if (_memoLongFired) { _memoLongFired = false; return; }
      // 짧은 탭 → +1
      const data = VERSES[state.quarter];
      if (!data || data.lessons.length === 0) return;
      const { q: mQ1, l: mL1 } = _hlRef(state.quarter, state.lesson);
      MemoLog.increment(mQ1, mL1);
      renderMemoCheck();
      if (navigator.vibrate) navigator.vibrate(20);
      memoCheckBtn.style.animation = "none";
      requestAnimationFrame(() => {
        memoCheckBtn.style.animation = "checkPop 0.3s ease";
      });
    });

    memoCheckBtn.addEventListener("pointerleave", () => {
      if (_memoTimer) { clearTimeout(_memoTimer); _memoTimer = null; }
    });

    memoCheckBtn.addEventListener("pointercancel", () => {
      if (_memoTimer) { clearTimeout(_memoTimer); _memoTimer = null; }
    });

    // 모두 보이기
    showAllBtn.addEventListener("click", () => {
      state.showAll = !state.showAll;
      showAllBtn.classList.toggle("active", state.showAll);
      showAllBtn.textContent = state.showAll ? "원래대로" : "모두보기";
      // step 5(구절만 보기)에서도 verseArea 표시 처리
      if (state.step === 5) {
        step2Hint.classList.toggle("hidden", state.showAll);   // showAll=true → hint 숨김
        verseArea.classList.toggle("hidden", !state.showAll);  // showAll=true → 구절 보임
        updateVerseImage();  // 이미지도 같이 갱신
      }
      renderVerseText();
    });

    // 부분숨김 다시 섞기
    refreshBtn.addEventListener("click", () => {
      recomputePartialHide();
      resetWordStates();
      renderVerseText();
    });

    // 카드 캡쳐·공유
    const shareBtn = $("#share-card-btn");
    if (shareBtn) {
      shareBtn.addEventListener("click", () => captureAndShareCard(shareBtn));
    }

    // 이미지 카드 만들기 (배경 + 본문 합성)
    const composeBtn = $("#compose-card-btn");
    if (composeBtn) {
      composeBtn.addEventListener("click", () => {
        if (typeof CardComposer === "undefined") {
          alert("카드 합성기를 불러오지 못했습니다.");
          return;
        }
        CardComposer.init();
        const verseText = collectCurrentVerseText();
        const refText   = getCurrentVerseRefText();
        const profile   = (typeof UserProfile !== "undefined") ? UserProfile.load() : {};
        CardComposer.open({
          verseText,
          verseRef: refText,
          userName: profile.name || "",
        });
      });
    }

    // 언어 설정 (설정 보기탭에 임베딩 — 적용 버튼)
    $("#lang-close").addEventListener("click", () => {
      state.primaryLang = primaryLangSel.value;
      state.secondaryLang = secondaryLangSel.value;
      state.tertiaryLang = tertiaryLangSel.value;
      state.dualMode = dualToggle.checked;
      state.tertiaryMode = tertiaryToggle.checked;
      $("#settings-panel").classList.add("hidden");
      resetWordStates();
      render();
      saveState();
    });

    dualToggle.addEventListener("change", () => {
      secondaryLangSel.disabled = !dualToggle.checked;
      if (!dualToggle.checked) {
        tertiaryToggle.checked = false;
        tertiaryLangSel.disabled = true;
      }
    });

    tertiaryToggle.addEventListener("change", () => {
      tertiaryLangSel.disabled = !tertiaryToggle.checked;
      if (tertiaryToggle.checked && !dualToggle.checked) {
        dualToggle.checked = true;
        secondaryLangSel.disabled = false;
      }
    });

    // ===== 즐겨찾기 버튼 =====
    favBtn.addEventListener("click", () => {
      if (state.quarter === "favorites") {
        // 즐겨찾기 뷰에서: _srcQuarter/_srcLesson 으로 해제
        const data = VERSES["favorites"];
        if (!data) return;
        const lessonData = data.lessons[state.lesson - 1];
        if (!lessonData) return;
        const srcQ = lessonData._srcQuarter;
        const srcL = lessonData._srcLesson;
        if (!srcQ || !srcL) return;
        FavoritesManager.toggle(srcQ, srcL, lessonData);
        rebuildFavorites();
        showToast("즐겨찾기에서 제거됨");
        // 목록 재렌더: 남은 즐겨찾기로 이동 또는 빈 화면
        const remaining = VERSES["favorites"].lessons;
        if (remaining.length === 0) {
          state.lesson = 1;
          render();
        } else {
          state.lesson = Math.min(state.lesson, remaining.length);
          render();
          updateLessonSelect(remaining);
        }
        return;
      }
      const data = VERSES[state.quarter];
      if (!data) return;
      const lessonData = data.lessons[state.lesson - 1];
      if (!lessonData) return;
      const { q: fvQ, l: fvL } = _hlRef(state.quarter, state.lesson);
      const added = FavoritesManager.toggle(fvQ, fvL, lessonData);
      updateFavBtn();
      rebuildFavorites();
      showToast(added ? "⭐ 즐겨찾기에 추가됨" : "즐겨찾기에서 제거됨");
    });

    // ===== step-row 스와이프 → 암송 단계 전환 =====
    const stepRow = document.getElementById("step-row");
    let stepTouchStartX = 0;
    stepRow.addEventListener("touchstart", (e) => {
      stepTouchStartX = e.touches[0].clientX;
    }, { passive: true });
    stepRow.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - stepTouchStartX;
      if (Math.abs(dx) > 50) {
        if (dx < 0) navigateStep(1);
        else navigateStep(-1);
      }
    }, { passive: true });

    // 음성 버튼 — 음성 패널 열기
    $("#audio-btn").addEventListener("click", () => {
      openAudioPanel();
    });

    // 설정 패널 — 버튼 아래 드롭다운
    $("#settings-btn").addEventListener("click", () => {
      openSettingsPanel("view");
      // 보기탭 열릴 때 현재 언어 상태 반영
      primaryLangSel.value   = state.primaryLang;
      secondaryLangSel.value = state.secondaryLang;
      tertiaryLangSel.value  = state.tertiaryLang;
      dualToggle.checked     = state.dualMode;
      tertiaryToggle.checked = state.tertiaryMode;
      secondaryLangSel.disabled = !state.dualMode;
      tertiaryLangSel.disabled  = !state.tertiaryMode;
    });
    $("#settings-close").addEventListener("click", () => {
      $("#settings-panel").classList.add("hidden");
    });

    // 설정 탭 전환
    document.querySelectorAll(".settings-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        switchSettingsTab(tab.dataset.tab);
      });
    });

    // 설정 오버레이 배경 클릭으로 닫기
    $("#settings-panel").addEventListener("click", (e) => {
      if (e.target === $("#settings-panel")) {
        $("#settings-panel").classList.add("hidden");
      }
    });

    // 형광펜
    $("#highlight-toggle").addEventListener("click", () => {
      const active = HighlightManager.toggle();
      $("#highlight-toggle").classList.toggle("active", active);
      highlightPalette.classList.toggle("hidden", !active);
      // 형광펜 ON/OFF 에 따라 카드에 커서 모드 클래스 토글
      cardBody.classList.toggle("highlight-mode-active", active);
    });

    highlightPalette.querySelectorAll(".hl-color").forEach((btn) => {
      btn.addEventListener("click", () => {
        highlightPalette.querySelectorAll(".hl-color").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        HighlightManager.setColor(btn.dataset.color);
      });
    });

    $("#highlight-clear-all").addEventListener("click", () => {
      const { q: hlQ, l: hlL } = _hlRef(state.quarter, state.lesson);
      HighlightManager.clearAllLangs(hlQ, hlL);
      [versePrimary, verseSecondary, verseTertiary].forEach(col => {
        col.querySelectorAll(".word").forEach(w => {
          w.classList.remove("highlight--yellow", "highlight--green", "highlight--pink", "highlight--blue", "highlight--orange", "highlight--purple", "highlight--custom");
        });
      });
    });

    // 폰트 크기 (설정 보기탭)
    $("#font-decrease").addEventListener("click", () => { adjustFontSize(-FONT_STEP); updateFontSizeLabel(); });
    $("#font-increase").addEventListener("click", () => { adjustFontSize(FONT_STEP);  updateFontSizeLabel(); });

    // ── 형광펜 드래그 상태 ────────────────────────────────────────
    let _hlDragging      = false;  // 드래그 추적 중 여부
    let _hlDragMoved     = false;  // 방향 확정 (가로 드래그 확인됨)
    let _hlSuppressClick = false;  // 가로 드래그 후 click 억제
    let _hlStartX        = 0;
    let _hlStartY        = 0;
    let _hlLastWordIdx   = -1;

    // 드래그 중 텍스트 선택 방지
    cardBody.addEventListener("selectstart", (e) => {
      if (HighlightManager.active && _hlDragging) e.preventDefault();
    });

    // 카드 클릭 (형광펜 탭 / 단어 탭)
    // 가로 드래그 후 발생하는 click은 _hlSuppressClick 으로 차단
    cardBody.addEventListener("click", (e) => {
      if (_hlSuppressClick) { _hlSuppressClick = false; return; }
      if (state.showAll) return;

      if (HighlightManager.active) {
        const wordEl = e.target.closest(".word");
        if (!wordEl) return;
        const idx    = parseInt(wordEl.dataset.index);
        const column = wordEl.closest(".verse-column");
        const lang   = colToLang(column);
        const { q: hlQ, l: hlL } = _hlRef(state.quarter, state.lesson);
        HighlightManager.applyToWord(hlQ, hlL, lang, idx);
        renderVerseText();
        return;
      }

      if (state.step === 2 || state.step === 4 || state.step === 5) {
        const column = e.target.closest(".verse-column");
        if (column === versePrimary) {
          handleWordTap(e, state.primaryWords, state.wordStatesPrimary);
        } else if (column === verseSecondary) {
          handleWordTap(e, state.secondaryWords, state.wordStatesSecondary);
        } else if (column === verseTertiary) {
          handleWordTap(e, state.tertiaryWords, state.wordStatesTertiary);
        }
      }
    });

    // ── 형광펜 드래그 (방향 감지: 가로만 형광펜, 세로는 스크롤) ──
    // touch-action: pan-y 와 함께 동작:
    //   - 세로 제스처 → 브라우저가 스크롤 처리 → pointercancel 발동 → 드래그 리셋
    //   - 가로 제스처 → JS가 처리 → 형광펜 적용
    cardBody.addEventListener("pointerdown", (e) => {
      if (!HighlightManager.active) return;
      _hlDragging    = true;
      _hlDragMoved   = false;
      _hlLastWordIdx = -1;
      _hlStartX      = e.clientX;
      _hlStartY      = e.clientY;
    });

    cardBody.addEventListener("pointermove", (e) => {
      if (!_hlDragging || !HighlightManager.active) return;

      const dx = Math.abs(e.clientX - _hlStartX);
      const dy = Math.abs(e.clientY - _hlStartY);

      if (!_hlDragMoved) {
        if (Math.hypot(dx, dy) < 8) return; // 아직 임계점 미달
        if (dy > dx) {
          // 세로 방향 우세 → 스크롤, 드래그 취소
          _hlDragging = false;
          return;
        }
        // 가로 방향 우세 → 드래그 확정, pointer capture 취득
        _hlDragMoved = true;
        try { cardBody.setPointerCapture(e.pointerId); } catch(err) {}
      }

      const el     = document.elementFromPoint(e.clientX, e.clientY);
      const wordEl = el?.closest(".word");
      if (!wordEl) return;
      const idx = parseInt(wordEl.dataset.index);
      if (idx === _hlLastWordIdx) return;
      _hlLastWordIdx = idx;
      const column = wordEl.closest(".verse-column");
      if (!column) return;
      const { q: hlQ, l: hlL } = _hlRef(state.quarter, state.lesson);
      HighlightManager.applyToWord(hlQ, hlL, colToLang(column), idx);
      renderVerseText();
    }, { passive: true });

    cardBody.addEventListener("pointerup", () => {
      if (!_hlDragging) return;
      if (_hlDragMoved) _hlSuppressClick = true;
      _hlDragging  = false;
      _hlDragMoved = false;
    });

    cardBody.addEventListener("pointercancel", () => {
      _hlDragging = false;
      _hlDragMoved = false;
    });

    // ── 스와이프로 과 이동 ───────────────────────────────────────
    // 형광펜 모드 ON 일 때는 스와이프를 무시 (드래그 = 형광펜)
    let touchStartX = 0, touchStartY = 0;
    card.addEventListener("touchstart", (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    card.addEventListener("touchend", (e) => {
      if (HighlightManager.active) return;  // 형광펜 ON → 스와이프 비활성
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx > 0) navigateLesson(-1);
        else navigateLesson(1);
      }
    }, { passive: true });

    // 검색 오버레이 배경 클릭으로 닫기
    const searchPanelEl = document.getElementById("search-panel");
    searchPanelEl.addEventListener("click", (e) => {
      if (e.target === searchPanelEl) searchPanelEl.classList.add("hidden");
    });

    // ===== 커스텀 형광펜 색상 =====
    const hlCustomBtn   = document.getElementById("hl-custom-btn");
    const hlCustomInput = document.getElementById("hl-custom-color");

    // 저장된 커스텀 색상 초기화
    (function initCustomColor() {
      const saved = localStorage.getItem("bible-hl-custom") || "#ff6b6b";
      hlCustomInput.value = saved;
      const rgba = hexToRgba(saved, 0.5);
      document.documentElement.style.setProperty("--hl-custom-bg", rgba);
      hlCustomBtn.style.background = rgba;
    })();

    hlCustomBtn.addEventListener("click", (e) => {
      // 팔레트 내 active 전환
      highlightPalette.querySelectorAll(".hl-color").forEach(b => b.classList.remove("active"));
      hlCustomBtn.classList.add("active");
      HighlightManager.setColor("custom");
      // 컬러피커 열기
      hlCustomInput.click();
      e.stopPropagation();
    });

    hlCustomInput.addEventListener("input", (e) => {
      const color = e.target.value;
      const rgba  = hexToRgba(color, 0.5);
      document.documentElement.style.setProperty("--hl-custom-bg", rgba);
      hlCustomBtn.style.background = rgba;
      localStorage.setItem("bible-hl-custom", color);
      HighlightManager.setColor("custom");
      highlightPalette.querySelectorAll(".hl-color").forEach(b => b.classList.remove("active"));
      hlCustomBtn.classList.add("active");
    });

    // ===== 폰트 선택 (설정 보기탭 인라인 버튼) =====
    document.querySelectorAll(".font-option").forEach(btn => {
      btn.addEventListener("click", () => {
        applyFont(btn.dataset.font);
      });
    });
  }

  // ===== hex → rgba 변환 =====
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ===== 폰트 선택 =====
  const FONTS = {
    system: "system-ui, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
    serif:  "'AppleMyungjo', 'Batang', 'Times New Roman', serif",
    dotum:  "Dotum, 'Apple SD Gothic Neo', 'Malgun Gothic', Arial, sans-serif",
    gothic: "'Apple Gothic', 'Nanum Gothic', 'Noto Sans KR', Arial, sans-serif"
  };

  function applyFont(fontKey) {
    const family = FONTS[fontKey] || FONTS.system;
    document.getElementById("verse-area").style.fontFamily = family;
    document.querySelectorAll(".font-option").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.font === fontKey);
    });
    localStorage.setItem("bible-font", fontKey);
  }

  function colToLang(col) {
    if (col === verseSecondary) return state.secondaryLang;
    if (col === verseTertiary)  return state.tertiaryLang;
    return state.primaryLang;
  }

  // ===== 폰트 크기 =====
  function adjustFontSize(delta) {
    state.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, state.fontSize + delta));
    applyFontSize();
    localStorage.setItem("bible-font-size", state.fontSize);
  }

  // ===== 설정 드롭다운 열기 (버튼 바로 아래, 전체 너비) =====
  function openSettingsPanel(tabName) {
    const btn     = document.getElementById("settings-btn");
    const panel   = document.getElementById("settings-panel");
    const content = panel.querySelector(".settings-dropdown-content");
    const rect    = btn.getBoundingClientRect();

    // 버튼 아래 8px, 좌우 100% (헤더 하단에서 바로 펼침)
    content.style.marginTop   = rect.bottom + "px";
    content.style.marginLeft  = "0";
    content.style.marginRight = "0";

    switchSettingsTab(tabName || "profile");
    panel.classList.remove("hidden");
  }

  function switchSettingsTab(tabName) {
    document.querySelectorAll(".settings-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.tab === tabName);
    });
    document.querySelectorAll(".settings-tab-content").forEach(c => {
      c.classList.toggle("hidden", c.id !== `stab-${tabName}`);
      c.classList.toggle("active", c.id === `stab-${tabName}`);
    });
    if (tabName === "user")    renderUserVerseList();
    if (tabName === "stats")   renderStats();
    if (tabName === "module")  renderModuleTab();
    if (tabName === "profile") loadProfileForm();
    if (tabName === "view") {
      primaryLangSel.value   = state.primaryLang;
      secondaryLangSel.value = state.secondaryLang;
      tertiaryLangSel.value  = state.tertiaryLang;
      dualToggle.checked     = state.dualMode;
      tertiaryToggle.checked = state.tertiaryMode;
      secondaryLangSel.disabled = !state.dualMode;
      tertiaryLangSel.disabled  = !state.tertiaryMode;
      updateFontSizeLabel();
    }
  }

  // ===== 내비게이션 =====
  function navigateLesson(dir) {
    const data = VERSES[state.quarter];
    if (!data) return;
    const newLesson = state.lesson + dir;
    if (newLesson < 1 || newLesson > data.lessons.length) return;

    card.classList.add(dir > 0 ? "swipe-left" : "swipe-right");
    setTimeout(() => {
      state.lesson = newLesson;
      state.showAll = false;
      showAllBtn.classList.remove("active");
      showAllBtn.textContent = "모두보기";
      resetWordStates();
      if (state.step === 2) recomputePartialHide();
      AudioManager.stop();
      render();
      saveState();
      card.classList.remove("swipe-left", "swipe-right");
    }, 150);
  }

  function navigateStep(dir) { goToStep(state.step + dir); }

  function goToStep(newStep) {
    if (newStep < 1 || newStep > MAX_STEP) return;
    state.step = newStep;
    state.showAll = false;
    showAllBtn.classList.remove("active");
    showAllBtn.textContent = "모두보기";
    resetWordStates();
    if (newStep === 2) recomputePartialHide();
    render();
    saveState();
  }

  function resetWordStates() {
    state.wordStatesPrimary   = {};
    state.wordStatesSecondary = {};
    state.wordStatesTertiary  = {};
  }

  function recomputePartialHide() {
    const data = VERSES[state.quarter];
    if (!data) return;
    const lesson = data.lessons[state.lesson - 1];
    if (!lesson) return;

    const ptxt = lesson.verse[state.primaryLang] || lesson.verse.ko;
    const pWords = tokenize(ptxt, state.primaryLang);
    state.partialIndicesPrimary = computePartialHideIndices(pWords, state.primaryLang);

    if (state.dualMode) {
      const stxt = lesson.verse[state.secondaryLang] || lesson.verse.en;
      const sWords = tokenize(stxt, state.secondaryLang);
      state.partialIndicesSecondary = computePartialHideIndices(sWords, state.secondaryLang);
    }

    if (state.tertiaryMode) {
      const ttxt = lesson.verse[state.tertiaryLang] || lesson.verse.en;
      const tWords = tokenize(ttxt, state.tertiaryLang);
      state.partialIndicesTertiary = computePartialHideIndices(tWords, state.tertiaryLang);
    }
  }

  // ===== 암송 체크 렌더링 =====
  function renderMemoCheck() {
    const data = VERSES[state.quarter];
    if (!data || data.lessons.length === 0) {
      memoCheckBtn.textContent = "✓";
      memoCheckBtn.classList.remove("checked");
      return;
    }
    const { q: mQr, l: mLr } = _hlRef(state.quarter, state.lesson);
    const { count } = MemoLog.get(mQr, mLr);
    if (count === 0) {
      memoCheckBtn.textContent = "✓";
      memoCheckBtn.classList.remove("checked");
    } else {
      memoCheckBtn.textContent = count >= 99 ? "99+" : String(count);
      memoCheckBtn.classList.add("checked");
    }
  }

  // ===== 렌더링 =====
  function render() {
    const data = VERSES[state.quarter];
    if (!data) return;

    // 사용자 성경절이 비어 있을 때
    if (data.lessons.length === 0) {
      lessonBadge.textContent = "";
      lessonTitle.textContent = "사용자 성경절";
      verseRef.textContent = "";
      versePrimary.innerHTML = `<div style="text-align:center;padding:30px 10px;color:var(--verse-text-dim);line-height:2">
        등록된 성경절이 없습니다.<br>
        <span style="font-size:13px">상단 ⚙️ 설정 › 성경절 탭에서 추가하세요.</span>
      </div>`;
      verseSecondary.classList.add("hidden");
      verseTertiary.classList.add("hidden");
      verseRefSecondary.classList.add("hidden");
      verseRefTertiary.classList.add("hidden");
      verseRefsBar.classList.add("hidden");
      step2Hint.classList.add("hidden");
      verseArea.classList.remove("hidden");
      refreshBtn.classList.add("hidden");
      renderStepControls();
      renderMemoCheck();
      AudioManager.load(null);
      $("#lesson-prev").disabled = true;
      $("#lesson-next").disabled = true;
      return;
    }

    const lessonData = data.lessons[state.lesson - 1];
    if (!lessonData) return;

    updateLessonSelect(data.lessons);

    const lessonNum = lessonData.badgeText || `제${lessonData.lesson}과`;
    lessonBadge.textContent = lessonNum;

    // 제목
    const isKoOnly = !!(data.koOnly);
    const titleP = lessonData.title[state.primaryLang] || lessonData.title.ko;
    let titleHTML = titleP;
    if (!isKoOnly && state.dualMode) {
      const titleS = lessonData.title[state.secondaryLang] || lessonData.title.en || "";
      const titleT = state.tertiaryMode
        ? (lessonData.title[state.tertiaryLang] || lessonData.title.en || "") : "";
      // 주 언어 제목과 동일하면 副제목 표시 안 함 (사용자 성경절 등 단일 주제어인 경우)
      const showS = titleS && titleS !== titleP;
      const showT = titleT && titleT !== titleP;
      if (showS || showT) {
        titleHTML += `<div class="lesson-title-secondary">`;
        if (showS) titleHTML += titleS;
        if (showS && showT) titleHTML += ` / `;
        if (!showS && showT) titleHTML += titleT;
        else if (showT) titleHTML += ` / ${titleT}`;
        titleHTML += `</div>`;
      }
    }
    lessonTitle.innerHTML = titleHTML;

    // 성경장절 (verse-refs-bar)
    verseRefsBar.classList.remove("hidden");
    verseRef.textContent = lessonData.reference[state.primaryLang] || lessonData.reference.ko;

    const showSec = !isKoOnly && state.dualMode;
    const showTer = !isKoOnly && state.dualMode && state.tertiaryMode;

    verseSecondary.classList.toggle("hidden", !showSec);
    verseTertiary.classList.toggle("hidden", !showTer);
    verseRefSecondary.classList.toggle("hidden", !showSec);
    verseRefTertiary.classList.toggle("hidden", !showTer);

    if (showSec) {
      verseRefSecondary.textContent = lessonData.reference[state.secondaryLang] || lessonData.reference.en;
    }
    if (showTer) {
      verseRefTertiary.textContent = lessonData.reference[state.tertiaryLang] || lessonData.reference.en;
    }

    // 단계 5: verse-area 전환 (verse-refs-bar는 항상 보임)
    const effectiveStep = state.showAll ? 1 : state.step;
    const isStep5 = effectiveStep === 5;
    step2Hint.classList.toggle("hidden", !isStep5);
    verseArea.classList.toggle("hidden", isStep5);

    // 새로고침 버튼: 2단계(부분숨김)에서만 표시
    refreshBtn.classList.toggle("hidden", state.step !== 2);

    renderVerseText();
    renderStepControls();
    renderMemoCheck();

    loadAudioSrc(lessonData.audio || null);
    updateAudioBtnBadge();
    updateFavBtn();
    updateVerseImage();
    updateImgBtnBadge();
    $("#lesson-prev").disabled = state.lesson <= 1;
    $("#lesson-next").disabled = state.lesson >= data.lessons.length;
  }

  function renderVerseText() {
    const data = VERSES[state.quarter];
    if (!data) return;
    const lessonData = data.lessons[state.lesson - 1];
    if (!lessonData) return;

    const effectiveStep = state.showAll ? 1 : state.step;

    const { q: hlQ, l: hlL } = _hlRef(state.quarter, state.lesson);

    const ptxt = lessonData.verse[state.primaryLang] || lessonData.verse.ko;
    const hlPrimary = effectiveStep !== 5
      ? HighlightManager.getHighlights(hlQ, hlL, state.primaryLang)
      : {};
    state.primaryWords = renderWords(
      versePrimary, ptxt, state.primaryLang, effectiveStep,
      state.wordStatesPrimary,
      { partialHideIndices: state.partialIndicesPrimary, highlights: hlPrimary }
    );

    if (state.dualMode) {
      const stxt = lessonData.verse[state.secondaryLang] || lessonData.verse.en;
      const hlSecondary = effectiveStep !== 5
        ? HighlightManager.getHighlights(hlQ, hlL, state.secondaryLang)
        : {};
      state.secondaryWords = renderWords(
        verseSecondary, stxt, state.secondaryLang, effectiveStep,
        state.wordStatesSecondary,
        { partialHideIndices: state.partialIndicesSecondary, highlights: hlSecondary }
      );
    }

    if (state.dualMode && state.tertiaryMode) {
      const ttxt = lessonData.verse[state.tertiaryLang] || lessonData.verse.en;
      const hlTertiary = effectiveStep !== 5
        ? HighlightManager.getHighlights(hlQ, hlL, state.tertiaryLang)
        : {};
      state.tertiaryWords = renderWords(
        verseTertiary, ttxt, state.tertiaryLang, effectiveStep,
        state.wordStatesTertiary,
        { partialHideIndices: state.partialIndicesTertiary, highlights: hlTertiary }
      );
    }

    renderExplanation(lessonData, effectiveStep);
  }

  function renderExplanation(lessonData, effectiveStep) {
    let el = $("#verse-explanation");
    if (!el) {
      el = document.createElement("div");
      el.id = "verse-explanation";
      el.className = "verse-explanation";
      verseArea.appendChild(el);
    }
    const expl = lessonData.explanation || "";
    if (!expl || effectiveStep === 5) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.textContent = expl;
  }

  function updateLessonSelect(lessons) {
    const data = VERSES[state.quarter];
    const isKoOnly = !!(data && data.koOnly);
    const isUser   = state.quarter === "user";
    lessonSelect.innerHTML = "";
    lessons.forEach(l => {
      const opt = document.createElement("option");
      opt.value = l.lesson;
      // 사용자 성경절: 주제어 표시 (koOnly 여부 무관)
      // 일반 성경절: 단일언어면 제목, 다국어면 "제N과"
      if (isUser) {
        opt.textContent = l.badgeText || l.title?.ko || `제${l.lesson}과`;
      } else {
        opt.textContent = isKoOnly ? (l.title?.ko || `${l.lesson}`) : `제${l.lesson}과`;
      }
      opt.selected = l.lesson === state.lesson;
      lessonSelect.appendChild(opt);
    });
  }

  function renderStepControls() {
    const effectiveStep = state.showAll ? 1 : state.step;
    stepLabel.textContent = STEP_LABELS[effectiveStep - 1] || "";
    stepDots.querySelectorAll(".dot").forEach(dot => {
      dot.classList.toggle("active", parseInt(dot.dataset.step) === state.step);
    });
    $("#step-prev").disabled = state.step <= 1;
    $("#step-next").disabled = state.step >= MAX_STEP;
  }

  // ===== 오디오 소스 로드 =====
  async function loadAudioSrc(src) {
    if (!src) { AudioManager.load(null); return; }
    if (src.startsWith("user:")) {
      const id = src.slice(5);
      const url = await AudioStore.getURL(id);
      AudioManager.load(url);
    } else {
      AudioManager.load(src);
    }
  }

  // ===== 사용자 성경절 VERSES 재빌드 =====
  function rebuildUserVerses() {
    const order = localStorage.getItem("bible-uv-sort") || "alpha";
    VERSES["user"] = UserVerseManager.buildVERSES(order);
  }

  // ===== 형광펜 키 참조 헬퍼 =====
  // · user 분기  : 위치가 아닌 verse _id 를 key로 → 정렬 바뀌어도 형광펜 고정
  // · favorites  : _srcQuarter/_srcLesson(원본 출처)을 key로 → 즐겨찾기 순서
  //                변경·해제에 무관, 원본 분기와 형광펜 공유
  function _hlRef(quarter, lesson) {
    if (quarter === "user") {
      const vid = VERSES["user"]?.lessons?.[lesson - 1]?._id;
      if (vid) return { q: vid, l: 1 };
    }
    if (quarter === "favorites") {
      const fav = VERSES["favorites"]?.lessons?.[lesson - 1];
      if (fav?._srcQuarter != null && fav?._srcLesson != null) {
        return { q: fav._srcQuarter, l: fav._srcLesson };
      }
    }
    return { q: quarter, l: lesson };
  }

  // ===== user 분기 MemoLog 마이그레이션: "user|X" → "uv-id|1" =====
  // lastChecked 타임스탬프를 사용한 시점-기반 복구:
  //   해당 항목이 마지막으로 갱신된 시점에 존재했던 성경절들만 가나다순으로
  //   정렬하여, 옛 위치(X)에 있던 verse 를 식별한다.
  //   → 부가 데이터 저장 후 새 성경절이 중간에 끼어들었던 경우에도 정확히 복구.
  function migrateMemoLog() {
    const data = MemoLog.getAll();
    const oldKeys = Object.keys(data).filter(k => /^user\|\d+$/.test(k));
    if (!oldKeys.length) return;
    const allVerses = UserVerseManager.load();
    const fallbackAlpha = [...allVerses].sort((a, b) =>
      (a.topic || "").localeCompare(b.topic || "", "ko")
    );
    oldKeys.forEach(oldKey => {
      const lessonNum = parseInt(oldKey.split("|")[1], 10);
      const entry = data[oldKey] || {};
      const T = entry.lastChecked || 0;
      let verse = null;
      if (T) {
        // 해당 시점까지 존재했던 성경절들만으로 가나다순 → 옛 위치 식별
        const versesAtT = allVerses
          .filter(v => (v.createdAt || 0) <= T)
          .sort((a, b) => (a.topic || "").localeCompare(b.topic || "", "ko"));
        verse = versesAtT[lessonNum - 1] || null;
      }
      // 타임스탬프 없거나 매칭 실패 시 현재 가나다순 fallback
      if (!verse) verse = fallbackAlpha[lessonNum - 1] || null;
      if (verse) {
        const newKey = `${verse.id}|1`;
        if (!data[newKey]) data[newKey] = entry;
      }
      delete data[oldKey];
    });
    MemoLog.saveAll(data);
  }

  // ===== user 분기 부가 데이터(형광펜·즐겨찾기·암기체크) 일괄 초기화 =====
  // 정렬 끼어들기로 매칭이 어긋난 경우 사용자가 수동으로 깨끗이 초기화할 수 있도록.
  function clearUserAuxData() {
    // Highlights
    Object.keys(HighlightManager.data).forEach(k => {
      if (/^user-\d+-/.test(k)) delete HighlightManager.data[k];
      else if (/^uv-/.test(k)) delete HighlightManager.data[k];
    });
    HighlightManager.save();
    // MemoLog
    const memoData = MemoLog.getAll();
    Object.keys(memoData).forEach(k => {
      if (/^user\|\d+$/.test(k)) delete memoData[k];
      else if (/^uv-[^|]+\|\d+$/.test(k)) delete memoData[k];
    });
    MemoLog.saveAll(memoData);
    // Favorites
    const favs = FavoritesManager.load().filter(f => {
      if (f.quarter === "user") return false;
      if (typeof f.quarter === "string" && f.quarter.startsWith("uv-")) return false;
      return true;
    });
    FavoritesManager.save(favs);
  }

  // ===== user 분기 즐겨찾기 마이그레이션: { quarter:"user", lesson:X } → { quarter:"uv-id", lesson:1 } =====
  function migrateFavorites() {
    const favs = FavoritesManager.load();
    const hasOld = favs.some(f => f.quarter === "user");
    if (!hasOld) return;
    const verses = UserVerseManager.getSorted("alpha");
    const newFavs = favs.map(f => {
      if (f.quarter !== "user") return f;
      const verse = verses[f.lesson - 1];
      if (!verse) return null; // 이미 삭제된 성경절이면 제거
      return { ...f, quarter: verse.id, lesson: 1 };
    }).filter(Boolean);
    FavoritesManager.save(newFavs);
  }

  // ===== MemoLog 통계 (user 분기는 _id 기반 키 사용) =====
  function _memoStatsFor(quarter, lessons) {
    if (quarter === "user") {
      const memoData = MemoLog.getAll();
      let checked = 0, proficient = 0;
      lessons.forEach(l => {
        if (!l._id) return;
        const k = `${l._id}|1`;
        const cnt = (memoData[k] || {}).count || 0;
        if (cnt >= 1) checked++;
        if (cnt >= 5) proficient++;
      });
      return { total: lessons.length, checked, proficient };
    }
    return MemoLog.statsFor(quarter, lessons);
  }

  // ===== 기존 user-X-lang 키 → uv-id-1-lang 마이그레이션 =====
  function migrateUserHighlights() {
    const hasOld = Object.keys(HighlightManager.data).some(k => /^user-\d+-/.test(k));
    if (!hasOld) return;
    // 알파순 정렬로 원래 저장 순서를 기준으로 이전
    const verses = UserVerseManager.getSorted("alpha");
    verses.forEach((v, i) => {
      ["ko", "en", "ja", "zh", "in"].forEach(lang => {
        const oldKey = `user-${i + 1}-${lang}`;
        const newKey = `${v.id}-1-${lang}`;
        if (HighlightManager.data[oldKey] && !HighlightManager.data[newKey]) {
          HighlightManager.data[newKey] = HighlightManager.data[oldKey];
        }
        delete HighlightManager.data[oldKey];
      });
    });
    HighlightManager.save();
  }

  // ===== 카드 캡쳐·공유 =====
  // 현재 카드(#card)를 PNG로 렌더링 → Web Share API 우선,
  // 미지원 시 다운로드로 폴백.
  async function captureAndShareCard(btn) {
    const card = document.getElementById("card");
    if (!card) return;
    if (typeof html2canvas !== "function") {
      alert("이미지 캡쳐 모듈을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (btn) btn.classList.add("busy");
    try {
      // 카드 배경 색상 동기화 (다크 톤 유지)
      const bg = getComputedStyle(card).backgroundColor || "#1a1a2e";
      const canvas = await html2canvas(card, {
        backgroundColor: bg,
        scale: Math.min(window.devicePixelRatio || 2, 3),
        useCORS: true,
        logging: false,
        allowTaint: true,
      });
      const fileName = buildCaptureFileName();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) {
        alert("이미지 생성에 실패했습니다.");
        return;
      }
      // 모바일 공유 (카톡 등)
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "성경절 카드",
            text: getCurrentVerseRefText(),
          });
          return;
        } catch (e) {
          // 사용자 취소 등 → 폴백 진행 안함
          if (e && e.name === "AbortError") return;
        }
      }
      // 폴백: 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("captureAndShareCard error:", err);
      alert("이미지 캡쳐 중 오류가 발생했습니다.");
    } finally {
      if (btn) btn.classList.remove("busy");
    }
  }

  function buildCaptureFileName() {
    const ref  = (getCurrentVerseRefText() || "verse").replace(/[\\/:*?"<>|\s]+/g, "_");
    const ymd  = new Date().toISOString().slice(0, 10);
    return `성경절_${ref}_${ymd}.png`;
  }

  function getCurrentVerseRefText() {
    const el = document.getElementById("verse-ref");
    return (el && el.textContent || "").trim();
  }

  // 카드 합성기에 넘길 본문 텍스트 — VERSES 데이터에서 직접 추출 (단계 영향 없음)
  function collectCurrentVerseText() {
    const q = state.quarter, l = state.lesson;
    const lessons = (VERSES[q] && VERSES[q].lessons) || [];
    const lesson = lessons[l - 1];
    if (!lesson) return "";
    const lang = state.primaryLang || "ko";
    const v = lesson.verse;
    if (!v) return "";
    if (typeof v === "string") return v;
    return v[lang] || v.ko || Object.values(v)[0] || "";
  }

  // ===== 즐겨찾기 VERSES 재빌드 =====
  function rebuildFavorites() {
    VERSES["favorites"] = FavoritesManager.buildVERSES();
  }

  // ===== 즐겨찾기 버튼 상태 업데이트 =====
  function updateFavBtn() {
    if (state.quarter === "favorites") {
      // 즐겨찾기 뷰에서는 항상 active(노란별) + 해제 가능 표시
      favBtn.classList.add("active");
      favBtn.title = "즐겨찾기 해제";
      return;
    }
    const { q: ifQ, l: ifL } = _hlRef(state.quarter, state.lesson);
    const isFav = FavoritesManager.isFavorite(ifQ, ifL);
    favBtn.classList.toggle("active", isFav);
    favBtn.title = isFav ? "즐겨찾기 해제" : "즐겨찾기 추가";
  }

  // ===== 글자 크기 레이블 업데이트 =====
  function updateFontSizeLabel() {
    const el = document.getElementById("font-size-label");
    if (el) el.textContent = state.fontSize + "px";
  }

  // ===== 통계 렌더링 =====
  function renderStats() {
    const statsContent = $("#stats-content");
    if (!statsContent) return;

    let totalAll = 0, checkedAll = 0, proficientAll = 0;
    let quartersHTML = "";

    // 현재 설치된 모듈 통계 (VERSES 기반)
    Object.entries(VERSES).forEach(([q, data]) => {
      if (!data || !data.lessons || data.lessons.length === 0) return;
      const s = _memoStatsFor(q, data.lessons);
      totalAll      += s.total;
      checkedAll    += s.checked;
      proficientAll += s.proficient;
      const checkedPct    = s.total ? Math.round(s.checked    / s.total * 100) : 0;
      const proficientPct = s.total ? Math.round(s.proficient / s.total * 100) : 0;
      quartersHTML += `
        <div class="stats-quarter-row">
          <div class="stats-quarter-name">${getQuarterName(q)}</div>
          <div class="stats-bar-wrap">
            <div class="stats-bar-bg">
              <div class="stats-bar-fill checked" style="width:${checkedPct}%"></div>
            </div>
            <div class="stats-bar-label">${s.checked}/${s.total}</div>
          </div>
          <div class="stats-bar-wrap">
            <div class="stats-bar-bg">
              <div class="stats-bar-fill proficient" style="width:${proficientPct}%"></div>
            </div>
            <div class="stats-bar-label" style="color:var(--gold)">${s.proficient}/${s.total}</div>
          </div>
        </div>`;
    });

    // 제거된 모듈 아카이브 통계
    const archived = ModuleManager.getArchivedStats();
    let archivedHTML = "";
    if (archived.length > 0) {
      archivedHTML = `<div class="stats-section-title" style="margin-top:16px;opacity:.7">📦 제거된 모듈 (보관 통계)</div>`;
      archived.forEach(a => {
        const checkedPct    = a.total ? Math.round(a.checked    / a.total * 100) : 0;
        const proficientPct = a.total ? Math.round(a.proficient / a.total * 100) : 0;
        archivedHTML += `
          <div class="stats-quarter-row" style="opacity:.6">
            <div class="stats-quarter-name">${a.shortName} <span style="font-size:10px;color:var(--text-dim)">(제거됨)</span></div>
            <div class="stats-bar-wrap">
              <div class="stats-bar-bg">
                <div class="stats-bar-fill checked" style="width:${checkedPct}%"></div>
              </div>
              <div class="stats-bar-label">${a.checked}/${a.total}</div>
            </div>
            <div class="stats-bar-wrap">
              <div class="stats-bar-bg">
                <div class="stats-bar-fill proficient" style="width:${proficientPct}%"></div>
              </div>
              <div class="stats-bar-label" style="color:var(--gold)">${a.proficient}/${a.total}</div>
            </div>
          </div>`;
      });
    }

    statsContent.innerHTML = `
      <div class="stats-section-title">📊 암송 현황</div>
      <div class="stats-legend">
        <div class="stats-legend-item">
          <div class="stats-legend-dot" style="background:#64dc78"></div>
          <span>완료 (1회 이상)</span>
        </div>
        <div class="stats-legend-item">
          <div class="stats-legend-dot" style="background:var(--gold)"></div>
          <span>숙달 (5회 이상)</span>
        </div>
      </div>
      ${quartersHTML || '<div class="search-placeholder">데이터를 불러오는 중…</div>'}
      ${archivedHTML}
      <div class="stats-total-row">
        <span class="stats-total-label">전체 성경절</span>
        <span class="stats-total-value">${totalAll}절</span>
      </div>
      <div class="stats-total-row">
        <span class="stats-total-label">완료 (1회↑)</span>
        <span class="stats-total-value" style="color:#64dc78">${checkedAll}절</span>
      </div>
      <div class="stats-total-row">
        <span class="stats-total-label">숙달 (5회↑)</span>
        <span class="stats-total-value" style="color:var(--gold)">${proficientAll}절</span>
      </div>`;
  }

  // ===== 모듈 관리 탭 렌더링 =====
  function renderModuleTab() {
    const installedList = document.getElementById("module-installed-list");
    const backupSection = document.getElementById("module-backup-section");
    const backupList    = document.getElementById("module-backup-list");
    if (!installedList) return;

    const reg    = ModuleManager.getRegistry();
    const allMods = Object.values(reg.modules || {});

    // ---- 설치된 모듈 ----
    const installed = allMods
      .filter(m => m.status === "installed")
      .sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));

    installedList.innerHTML = installed.length === 0
      ? '<div class="module-empty">설치된 모듈이 없습니다.</div>'
      : installed.map(mod => _moduleCardHTML(mod)).join("");

    // ---- 제거된 모듈 ----
    const backedUp = allMods.filter(m => m.status === "backed-up");
    if (backedUp.length > 0) {
      backupSection.style.display = "";

      // 내장 모듈(window.VERSES_* 에 데이터 있는 것)이 하나라도 있으면 "모두 재설치" 버튼 표시
      const hasAnyBuiltin = backedUp.some(m => _isBuiltinModule(m.moduleId));
      const reinstallAllBtn = hasAnyBuiltin
        ? `<button class="module-reinstall-all-btn" id="reinstall-all-btn">🏠 내장 모듈 모두 재설치</button>`
        : "";

      backupList.innerHTML = reinstallAllBtn + backedUp.map(mod => {
        const dateStr  = mod.removedAt
          ? new Date(mod.removedAt).toLocaleDateString("ko-KR") : "";
        const isBuiltin = _isBuiltinModule(mod.moduleId);
        const badge     = isBuiltin
          ? `<span class="module-builtin-badge">🏠 내장</span>` : "";
        const actionBtn = isBuiltin
          ? `<button class="module-btn module-btn-reinstall" data-id="${mod.moduleId}">재설치</button>`
          : `<button class="module-btn module-btn-restore"   data-id="${mod.moduleId}">복원</button>`;
        return `
          <div class="module-card module-card-removed">
            <div class="module-card-left">
              <div class="module-card-name">${_modName(mod)}${badge}</div>
              <div class="module-card-meta">제거됨${dateStr ? " · " + dateStr : ""}</div>
            </div>
            <div class="module-card-actions">${actionBtn}</div>
          </div>`;
      }).join("");
    } else {
      backupSection.style.display = "none";
    }

    // ---- 이벤트 바인딩 ----
    installedList.querySelectorAll(".module-btn-remove").forEach(btn => {
      btn.addEventListener("click", () => _showModuleRemoveModal(btn.dataset.id));
    });
    installedList.querySelectorAll(".module-btn-export").forEach(btn => {
      btn.addEventListener("click", () => _exportModule(btn.dataset.id));
    });
    installedList.querySelectorAll(".module-btn-rename").forEach(btn => {
      btn.addEventListener("click", () => _editModuleName(btn.dataset.id));
    });
    installedList.querySelectorAll(".mod-order-btn").forEach(btn => {
      btn.addEventListener("click", () => _moveModule(btn.dataset.id, btn.dataset.dir));
    });
    if (backupList) {
      // 내장 모듈 재설치
      backupList.querySelectorAll(".module-btn-reinstall").forEach(btn => {
        btn.addEventListener("click", () => _reinstallBuiltin(btn.dataset.id));
      });
      // 외부 백업 파일로 복원
      backupList.querySelectorAll(".module-btn-restore").forEach(btn => {
        btn.addEventListener("click", () => {
          showToast("백업 파일(.json)을 선택하세요");
          document.getElementById("module-file-input").click();
        });
      });
      // 내장 모듈 모두 재설치
      const reinstallAllBtn = document.getElementById("reinstall-all-btn");
      if (reinstallAllBtn) {
        reinstallAllBtn.addEventListener("click", _reinstallAllBuiltins);
      }
    }
  }

  // ── 내장 모듈 여부 판별 ────────────────────────────────────────
  // window.VERSES_* 글로벌에 데이터가 있으면 내장 모듈
  function _isBuiltinModule(moduleId) {
    for (const key of Object.keys(window).filter(k => k.startsWith("VERSES_"))) {
      if (window[key]?.[moduleId]) return true;
    }
    return false;
  }

  // ── 내장 모듈 1개 재설치 ──────────────────────────────────────
  async function _reinstallBuiltin(moduleId) {
    let data = null;
    for (const key of Object.keys(window).filter(k => k.startsWith("VERSES_"))) {
      if (window[key]?.[moduleId]) { data = window[key][moduleId]; break; }
    }
    if (!data) { showToast("⚠ 내장 데이터를 찾을 수 없습니다."); return; }

    try {
      await ModuleManager.reinstallBuiltin(moduleId, data);
      VERSES[moduleId] = data;
      rebuildQuarterSelect();
      renderModuleTab();
      showToast(`✅ ${moduleId} 재설치 완료`);
    } catch(e) {
      showToast("⚠ 재설치 실패: " + e.message);
    }
  }

  // ── 내장 모듈 전체 재설치 ─────────────────────────────────────
  async function _reinstallAllBuiltins() {
    const reg     = ModuleManager.getRegistry();
    const targets = Object.values(reg.modules || {})
      .filter(m => m.status === "backed-up" && _isBuiltinModule(m.moduleId));
    if (!targets.length) { showToast("재설치할 내장 모듈이 없습니다."); return; }

    let count = 0;
    for (const mod of targets) {
      let data = null;
      for (const key of Object.keys(window).filter(k => k.startsWith("VERSES_"))) {
        if (window[key]?.[mod.moduleId]) { data = window[key][mod.moduleId]; break; }
      }
      if (!data) continue;
      try {
        await ModuleManager.reinstallBuiltin(mod.moduleId, data);
        VERSES[mod.moduleId] = data;
        count++;
      } catch(e) {}
    }

    rebuildQuarterSelect();
    renderModuleTab();
    showToast(`✅ 내장 모듈 ${count}개 재설치 완료`);
  }

  function _moduleCardHTML(mod) {
    const isPerm  = ModuleManager.isPermanent(mod.moduleId);
    const langCnt = (mod.languages || []).length;
    const meta    = `${mod.lessonCount || 0}과${langCnt > 0 ? " · " + langCnt + "개국어" : ""}`;
    const name    = _modName(mod);

    if (isPerm) {
      // 영구 모듈 (favorites/user): 순서·이름 변경 불가
      return `
        <div class="module-card">
          <div class="module-card-left">
            <div class="module-card-name">${name}</div>
            <div class="module-card-meta">${meta}</div>
          </div>
          <div class="module-card-actions">
            <span class="module-perm-badge" title="영구 모듈">🔒</span>
          </div>
        </div>`;
    }
    return `
      <div class="module-card">
        <div class="module-card-order">
          <button class="mod-order-btn" data-id="${mod.moduleId}" data-dir="up"  title="위로">▲</button>
          <button class="mod-order-btn" data-id="${mod.moduleId}" data-dir="down" title="아래로">▼</button>
        </div>
        <div class="module-card-left">
          <div class="module-card-name">${name}</div>
          <div class="module-card-meta">${meta}</div>
        </div>
        <div class="module-card-actions">
          <button class="module-btn module-btn-rename" data-id="${mod.moduleId}" title="이름 수정">✏</button>
          <button class="module-btn module-btn-export" data-id="${mod.moduleId}" title="파일로 내보내기">↓</button>
          <button class="module-btn module-btn-remove" data-id="${mod.moduleId}">제거</button>
        </div>
      </div>`;
  }

  // ===== 모듈 내보내기 (.module.json) =====
  async function _exportModule(moduleId) {
    const mod = ModuleManager.getModule(moduleId);
    if (!mod) { showToast("⚠ 모듈 정보를 찾을 수 없습니다."); return; }
    try {
      const data = await ModuleManager.getModuleData(moduleId);
      if (!data) { showToast("⚠ 모듈 데이터가 없습니다."); return; }
      // manifest 에서 name 필드 보완 (레거시 모듈은 displayName 만 있을 수 있음)
      const manifest = { ...mod };
      delete manifest.status; delete manifest.installedAt; delete manifest.reinstalledAt; delete manifest.removedAt;
      if (!manifest.name && manifest.displayName) {
        manifest.name = { ko: manifest.displayName };
      }
      const bundle = { manifest, data };
      const json   = JSON.stringify(bundle, null, 2);
      const blob   = new Blob([json], { type: "application/json" });
      const a      = document.createElement("a");
      a.href       = URL.createObjectURL(blob);
      a.download   = `${moduleId}.module.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast(`✅ ${_modName(mod)}.module.json 저장됨`);
    } catch(e) {
      showToast("⚠ 내보내기 실패: " + e.message);
    }
  }

  // ===== 모듈 이름 수정 =====
  function _editModuleName(moduleId) {
    const mod = ModuleManager.getModule(moduleId);
    if (!mod) return;
    const current = _modName(mod);
    const newName = prompt("모듈 이름 수정:", current);
    if (newName === null) return;            // 취소
    const trimmed = newName.trim();
    if (!trimmed) return;
    ModuleManager.updateModuleMeta(moduleId, { customName: trimmed });
    renderModuleTab();
    rebuildQuarterSelect();
    showToast(`✅ "${trimmed}"로 변경됨`);
  }

  // ===== 모듈 순서 이동 (▲ ▼) =====
  function _moveModule(moduleId, dir) {
    // favorites·user 제외, 현재 sortOrder 기준 정렬된 목록
    const list = ModuleManager.getInstalledModules()
      .filter(m => m.moduleId !== "favorites" && m.moduleId !== "user");
    const idx     = list.findIndex(m => m.moduleId === moduleId);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;

    // sortOrder 값 교환
    const orderA = list[idx].sortOrder;
    const orderB = list[swapIdx].sortOrder;
    ModuleManager.updateModuleMeta(list[idx].moduleId,     { sortOrder: orderB });
    ModuleManager.updateModuleMeta(list[swapIdx].moduleId, { sortOrder: orderA });

    renderModuleTab();
    rebuildQuarterSelect();
  }

  // ===== 모듈 제거 확인 모달 =====
  let _pendingRemoveId = null;

  function _showModuleRemoveModal(moduleId) {
    const mod = ModuleManager.getModule(moduleId);
    if (!mod) return;
    _pendingRemoveId = moduleId;
    document.getElementById("module-modal-title").textContent =
      `"${_modName(mod)}" 제거`;
    document.getElementById("module-modal-desc").innerHTML = `
      이 모듈의 성경절 데이터를 제거합니다.<br>
      <span style="color:var(--gold);font-size:12px">
        ✦ 형광펜·암송 기록은 보존됩니다<br>
        ✦ 음성·이미지는 <b>백업 후 제거</b> 시 파일에 포함됩니다
      </span>`;
    document.getElementById("module-modal").classList.remove("hidden");
  }

  async function _executeModuleRemove(moduleId, withBackup) {
    const mod = ModuleManager.getModule(moduleId);
    if (!mod) return;

    // 백업 파일 생성 & 다운로드
    if (withBackup) {
      try {
        showToast("백업 파일 생성 중…");
        const bundle = await ModuleManager.createBackup(moduleId, { includeMedia: true });
        ModuleManager.downloadBackup(bundle);
      } catch(e) {
        showToast("⚠ 백업 실패: " + e.message);
        return;
      }
    }

    // 현재 보고 있던 모듈이면 다른 곳으로 이동
    const isCurrentQuarter = mod.quarterKeys?.includes(state.quarter);

    await ModuleManager.remove(moduleId);

    // VERSES 메모리에서 제거
    (mod.quarterKeys || []).forEach(q => delete VERSES[q]);

    rebuildQuarterSelect();
    renderModuleTab();

    if (isCurrentQuarter) {
      const firstVal = document.querySelector("#quarter-select option")?.value || "favorites";
      state.quarter = firstVal;
      state.lesson  = 1;
      quarterSelect.value = firstVal;
      if (firstVal !== "favorites" && firstVal !== "user") {
        await DataLoader.load(DataLoader.getYear(firstVal));
      }
      applyTheme();
      render();
      saveState();
    }

    showToast(`"${_modName(mod)}" 제거됨`);
  }

  // ===== 모듈 파일 가져오기 (설치 or 복원) =====
  async function _handleModuleFile(file) {
    if (!file) return;
    let json;
    try {
      const text = await file.text();
      json = JSON.parse(text);
    } catch(e) {
      showToast("⚠ 파일을 읽을 수 없습니다."); return;
    }

    if (!json.manifest?.moduleId || !json.data) {
      showToast("⚠ 유효하지 않은 모듈 파일입니다."); return;
    }

    const isBackup = !!json.userData;
    const name = json.manifest.shortName || json.manifest.moduleId;

    try {
      if (isBackup) {
        await ModuleManager.restore(json, { includeUserData: true });
        showToast(`✅ "${name}" 복원 완료`);
      } else {
        await ModuleManager.install(json);
        showToast(`✅ "${name}" 설치 완료`);
      }
      // VERSES에 데이터 병합
      const data = await ModuleManager.getModuleData(json.manifest.moduleId);
      if (data) Object.assign(VERSES, data);
      rebuildQuarterSelect();
      renderModuleTab();
    } catch(e) {
      showToast("⚠ " + e.message);
    }
  }

  // ===== 모듈 이벤트 바인딩 =====
  function bindModuleEvents() {
    // 모달 버튼
    document.getElementById("module-modal-cancel")?.addEventListener("click", () => {
      document.getElementById("module-modal").classList.add("hidden");
      _pendingRemoveId = null;
    });
    document.getElementById("module-modal-direct")?.addEventListener("click", async () => {
      document.getElementById("module-modal").classList.add("hidden");
      if (_pendingRemoveId) await _executeModuleRemove(_pendingRemoveId, false);
      _pendingRemoveId = null;
    });
    document.getElementById("module-modal-backup")?.addEventListener("click", async () => {
      document.getElementById("module-modal").classList.add("hidden");
      if (_pendingRemoveId) await _executeModuleRemove(_pendingRemoveId, true);
      _pendingRemoveId = null;
    });
    // 모달 배경 클릭 → 닫기
    document.getElementById("module-modal")?.addEventListener("click", (e) => {
      if (e.target === document.getElementById("module-modal")) {
        document.getElementById("module-modal").classList.add("hidden");
        _pendingRemoveId = null;
      }
    });

    // 파일 가져오기
    const fileInput  = document.getElementById("module-file-input");
    const importBtn  = document.getElementById("module-import-btn");
    importBtn?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (file) await _handleModuleFile(file);
      fileInput.value = "";
    });
  }

  // ===== 스플래시 화면 =====
  // 하루 1회만 자동 표시 (날짜 기준). 신규 사용자(이름 미설정)는 무조건 표시.
  function showSplash(opts) {
    const force = !!(opts && opts.force);
    const splash   = document.getElementById("splash-screen");
    const welcomeEl= document.getElementById("splash-welcome");
    const profile  = UserProfile.load();

    if (!force && profile.name) {
      const today = new Date().toISOString().slice(0, 10);
      const last  = localStorage.getItem("bible-splash-last-shown");
      if (last === today) {
        // 오늘 이미 표시함 → 자동 표시 생략
        splash.classList.add("hidden");
        return;
      }
    }

    let html = "";
    if (profile.name) {
      html += `<div class="splash-greeting">안녕하세요,<br><strong>${escapeHtml(profile.name)}</strong>님! 👋<br>
               <span style="font-size:14px;font-weight:400;opacity:.8">오늘도 말씀을 암송하며<br>마음에 새겨보세요.</span></div>`;
    } else {
      html += `<div class="splash-greeting">환영합니다! 👋<br>
               <span style="font-size:14px;font-weight:400;opacity:.8">성경 말씀을 암송하여<br>마음에 새겨보세요.</span></div>`;
    }

    if (profile.favoriteVerse && profile.favoriteVerse.trim()) {
      html += `<div class="splash-verse-label">✦ 내가 가장 사랑하는 말씀</div>
               <div class="splash-verse-text">${escapeHtml(profile.favoriteVerse.trim())}</div>`;
    }

    welcomeEl.innerHTML = html;
    splash.classList.remove("hidden");

    // 표시 일자 기록 (신규/수동 표시 포함)
    try {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem("bible-splash-last-shown", today);
    } catch (e) {}
  }

  function hideSplash() {
    const splash = document.getElementById("splash-screen");
    splash.classList.add("hiding");
    setTimeout(() => splash.classList.add("hidden"), 460);
  }

  // ===== 사용자 프로필 폼 =====
  function loadProfileForm() {
    const profile = UserProfile.load();
    $("#p-name").value  = profile.name  || "";
    $("#p-verse").value = profile.favoriteVerse || "";
  }

  function bindProfileEvents() {
    // 시작하기 버튼
    document.getElementById("splash-start").addEventListener("click", hideSplash);

    // 프로필 저장
    document.getElementById("profile-save-btn").addEventListener("click", () => {
      const name  = ($("#p-name").value  || "").trim();
      const verse = ($("#p-verse").value || "").trim();
      UserProfile.save({ name, favoriteVerse: verse });
      $("#settings-panel").classList.add("hidden");
      // 저장 확인 토스트
      showToast(name ? `${name}님, 저장되었습니다 ✓` : "저장되었습니다 ✓");
    });
  }

  // 간단한 토스트 메시지
  function showToast(msg) {
    let t = document.getElementById("app-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "app-toast";
      t.style.cssText = `
        position:fixed; bottom:90px; left:50%; transform:translateX(-50%);
        background:rgba(30,30,50,0.92); color:#fff; padding:9px 20px;
        border-radius:20px; font-size:13px; z-index:999; white-space:nowrap;
        border:1px solid rgba(255,255,255,0.12);
        box-shadow:0 4px 16px rgba(0,0,0,0.4);
        pointer-events:none; transition:opacity 0.3s;`;
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = "0"; }, 2200);
  }

  // ===== 음성 패널 =====
  let _apRecInterval = null;
  let _apRecAudio    = null;  // 개인 녹음 재생용 Audio 객체
  let _audioLang     = null;  // 패널에서 선택된 녹음 언어

  function _recKey() {
    // 카드 배지용 (현재 주 언어)
    return `rec:${state.quarter}:${state.lesson}:${state.primaryLang}`;
  }

  function _audioRecKey() {
    // 음성 패널 내 녹음 조작용 (패널 선택 언어)
    return `rec:${state.quarter}:${state.lesson}:${_audioLang || state.primaryLang}`;
  }

  function openAudioPanel() {
    const panel   = document.getElementById("audio-panel");
    const content = document.getElementById("audio-dropdown-content");

    // 패널 열릴 때 현재 주 언어로 초기화
    _audioLang = state.primaryLang;

    // 하단 고정 — marginTop 불필요
    content.style.marginTop   = "";
    content.style.marginLeft  = "0";
    content.style.marginRight = "0";
    panel.classList.remove("hidden");
    renderAudioPanel();
  }

  function closeAudioPanel() {
    document.getElementById("audio-panel").classList.add("hidden");
    _stopRecAudio();
    AudioManager.stop();
    _resetPresetBtns();
  }

  function _resetPresetBtns() {
    const play = document.getElementById("ap-preset-play");
    const stop = document.getElementById("ap-preset-stop");
    if (play && stop) {
      play.classList.remove("hidden");
      stop.classList.add("hidden");
    }
  }

  function _stopRecAudio() {
    if (_apRecAudio) {
      _apRecAudio.pause();
      _apRecAudio.src = "";
      _apRecAudio = null;
    }
    const play = document.getElementById("ap-rec-play");
    const stop = document.getElementById("ap-rec-play-stop");
    if (play && stop) {
      play.classList.remove("hidden");
      stop.classList.add("hidden");
    }
  }

  async function renderAudioPanel() {
    // 기본 음성 섹션
    const hasPreset = AudioManager._hasPreset;
    document.getElementById("ap-preset-badge").textContent = hasPreset ? "있음" : "없음";
    document.getElementById("ap-preset-badge").className =
      "audio-badge " + (hasPreset ? "audio-badge--has" : "audio-badge--none");
    document.getElementById("ap-preset-play").disabled = !hasPreset;

    // 언어 탭 업데이트 (녹음 유무 표시)
    const allLangs = ["ko", "en", "ja", "zh", "in"];
    const tabs = document.querySelectorAll(".ap-lang-tab");
    await Promise.all(allLangs.map(async (lc, i) => {
      const key = `rec:${state.quarter}:${state.lesson}:${lc}`;
      const url = await AudioStore.getURL(key);
      if (tabs[i]) {
        tabs[i].classList.toggle("active", lc === _audioLang);
        tabs[i].classList.toggle("has-rec", !!url);
      }
    }));

    // 개인 녹음 섹션 (선택된 _audioLang 기준)
    const recUrl = await AudioStore.getURL(_audioRecKey());
    const recBadge   = document.getElementById("ap-rec-badge");
    const stateEmpty = document.getElementById("ap-state-empty");
    const stateRec   = document.getElementById("ap-state-recording");
    const stateRecorded = document.getElementById("ap-state-recorded");

    if (VoiceRecorder.isRecording) {
      recBadge.textContent = "녹음 중";
      recBadge.className   = "audio-badge audio-badge--recording";
      stateEmpty.classList.add("hidden");
      stateRec.classList.remove("hidden");
      stateRecorded.classList.add("hidden");
    } else if (recUrl) {
      recBadge.textContent = "녹음 있음";
      recBadge.className   = "audio-badge audio-badge--has";
      stateEmpty.classList.add("hidden");
      stateRec.classList.add("hidden");
      stateRecorded.classList.remove("hidden");
    } else {
      recBadge.textContent = "없음";
      recBadge.className   = "audio-badge audio-badge--none";
      stateEmpty.classList.remove("hidden");
      stateRec.classList.add("hidden");
      stateRecorded.classList.add("hidden");
    }

    // 헤더 버튼 — 주 언어 녹음 유무 표시
    const mainRecUrl = await AudioStore.getURL(_recKey());
    document.getElementById("audio-btn").classList.toggle("has-recording", !!mainRecUrl);
  }

  // 음성 버튼 녹음 표시 (과 이동 시 갱신)
  async function updateAudioBtnBadge() {
    const url = await AudioStore.getURL(_recKey());
    document.getElementById("audio-btn").classList.toggle("has-recording", !!url);
  }

  async function _startRecording() {
    try {
      await VoiceRecorder.start();
      let sec = 0;
      const timerEl = document.getElementById("ap-rec-timer-panel");
      timerEl.textContent = "00:00";
      clearInterval(_apRecInterval);
      _apRecInterval = setInterval(() => {
        sec++;
        timerEl.textContent =
          String(Math.floor(sec / 60)).padStart(2, "0") + ":" +
          String(sec % 60).padStart(2, "0");
      }, 1000);
      renderAudioPanel();
    } catch (e) {
      alert("마이크 접근 권한이 필요합니다.\n브라우저 설정에서 마이크를 허용해 주세요.");
    }
  }

  function bindAudioPanelEvents() {
    const panel = document.getElementById("audio-panel");

    // 오버레이 배경 클릭으로 닫기
    panel.addEventListener("click", (e) => {
      if (e.target === panel) closeAudioPanel();
    });
    document.getElementById("audio-panel-close").addEventListener("click", closeAudioPanel);

    // ── 언어 탭 클릭 ──
    document.getElementById("ap-lang-tabs").addEventListener("click", async (e) => {
      const tab = e.target.closest(".ap-lang-tab");
      if (!tab) return;
      if (VoiceRecorder.isRecording) {
        alert("녹음 중에는 언어를 변경할 수 없습니다.");
        return;
      }
      _stopRecAudio();
      _audioLang = tab.dataset.lang;
      renderAudioPanel();
    });

    // ── 기본 음성 재생/정지 ──
    document.getElementById("ap-preset-play").addEventListener("click", () => {
      AudioManager.stop();
      AudioManager.playPreset();
      document.getElementById("ap-preset-play").classList.add("hidden");
      document.getElementById("ap-preset-stop").classList.remove("hidden");
      AudioManager.player.addEventListener("ended", function onEnd() {
        _resetPresetBtns();
        AudioManager.player.removeEventListener("ended", onEnd);
      });
    });

    document.getElementById("ap-preset-stop").addEventListener("click", () => {
      AudioManager.stop();
      _resetPresetBtns();
    });

    // ── 개인 녹음 재생/정지 ──
    document.getElementById("ap-rec-play").addEventListener("click", async () => {
      const url = await AudioStore.getURL(_audioRecKey());
      if (!url) return;
      _stopRecAudio();
      _apRecAudio = new Audio(url);
      _apRecAudio.play().catch(() => {});
      document.getElementById("ap-rec-play").classList.add("hidden");
      document.getElementById("ap-rec-play-stop").classList.remove("hidden");
      _apRecAudio.addEventListener("ended", () => {
        _stopRecAudio();
      });
    });

    document.getElementById("ap-rec-play-stop").addEventListener("click", () => {
      _stopRecAudio();
    });

    // ── 녹음 시작 (신규 / 다시 녹음) ──
    document.getElementById("ap-rec-start").addEventListener("click", _startRecording);
    document.getElementById("ap-rec-redo").addEventListener("click", () => {
      _stopRecAudio();
      _startRecording();
    });

    // ── 녹음 중지 및 저장 ──
    document.getElementById("ap-rec-stop").addEventListener("click", async () => {
      clearInterval(_apRecInterval);
      _apRecInterval = null;
      const blob = await VoiceRecorder.stop();
      if (blob) {
        await AudioStore.save(_audioRecKey(), blob);
      }
      renderAudioPanel();
    });

    // ── 녹음 삭제 ──
    document.getElementById("ap-rec-delete").addEventListener("click", async () => {
      if (!confirm("내 녹음을 삭제하시겠습니까?")) return;
      _stopRecAudio();
      await AudioStore.delete(_audioRecKey());
      renderAudioPanel();
    });
  }

  // ===== 이미지 패널 =====

  // 기설정 분기 → 이미지 경로 매핑 (ASCII 파일명, 모바일 호환)
  // 파일명 형식: images/q{quarter}-{NN}.png  예) q2026-01-03.png
  // 3기, 4기: 이미지 준비되면 Set에 추가
  const PRESET_IMAGE_QUARTERS = new Set(["2026-01", "2026-02"]);

  function getPresetImagePath(quarter, lesson) {
    if (!PRESET_IMAGE_QUARTERS.has(quarter)) return null;
    const num = String(lesson).padStart(2, "0");
    return `images/q${quarter}-${num}.png`;
  }

  function _imgKey() {
    return `img:${state.quarter}:${state.lesson}`;
  }

  // Step 5 이미지 표시 갱신
  async function updateVerseImage() {
    const isStep5 = (state.step === 5) && !state.showAll;
    if (!isStep5) {
      verseImageArea.classList.add("hidden");
      return;
    }
    // 1순위: 사용자 업로드 이미지
    const userUrl = await ImageStore.getURL(_imgKey());
    if (userUrl) {
      verseImageEl.src = userUrl;
      verseImageArea.classList.remove("hidden");
      return;
    }
    // 2순위: 기설정 이미지
    const presetPath = getPresetImagePath(state.quarter, state.lesson);
    if (presetPath) {
      verseImageEl.onload  = () => { verseImageEl.onload = null; verseImageArea.classList.remove("hidden"); };
      verseImageEl.onerror = () => { verseImageEl.onerror = null; verseImageArea.classList.add("hidden"); };
      verseImageEl.src = presetPath;
      return;
    }
    verseImageArea.classList.add("hidden");
  }

  // 이미지 버튼 뱃지 갱신
  async function updateImgBtnBadge() {
    const userUrl    = await ImageStore.getURL(_imgKey());
    const presetPath = getPresetImagePath(state.quarter, state.lesson);
    imgBtn.classList.toggle("has-image", !!(userUrl || presetPath));
  }

  // 이미지 패널 열기
  async function openImgPanel() {
    imgPanel.classList.remove("hidden");
    await renderImgPanel();
  }

  function closeImgPanel() {
    imgPanel.classList.add("hidden");
  }

  async function renderImgPanel() {
    const userUrl    = await ImageStore.getURL(_imgKey());
    const presetPath = getPresetImagePath(state.quarter, state.lesson);
    const thumb      = $("#img-panel-thumb");
    const empty      = $("#img-panel-empty");
    const sourceEl   = $("#img-panel-source");
    const delBtn     = $("#img-delete-btn");

    if (userUrl) {
      thumb.src = userUrl;
      thumb.classList.remove("hidden");
      empty.style.display = "none";
      sourceEl.textContent = "내 이미지";
    } else if (presetPath) {
      thumb.src = presetPath;
      thumb.classList.remove("hidden");
      thumb.onerror = () => { thumb.onerror = null; thumb.classList.add("hidden"); empty.style.display = "flex"; };
      thumb.onload  = () => { thumb.onload = null; };
      empty.style.display = "none";
      sourceEl.textContent = "기본 이미지";
    } else {
      thumb.classList.add("hidden");
      empty.style.display = "flex";
      sourceEl.textContent = "이미지 없음";
    }
    delBtn.classList.toggle("hidden", !userUrl);
  }

  // 이미지 파일 처리 (압축 → 저장)
  async function processImageFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      showToast("이미지 파일을 선택해 주세요.", "error"); return;
    }
    try {
      showToast("이미지 처리 중…");
      const blob   = await ImageStore.compress(file, { maxFileMB: 4 });
      const sizeKB = Math.round(blob.size / 1024);
      await ImageStore.save(_imgKey(), blob);
      showToast(`이미지 저장됨 (${sizeKB}KB)`);
      await renderImgPanel();
      await updateImgBtnBadge();
      if (state.step === 5) await updateVerseImage();
    } catch (e) {
      showToast(e.message);
    }
  }

  function bindImagePanelEvents() {
    // 이미지 버튼 토글
    imgBtn.addEventListener("click", () => {
      if (imgPanel.classList.contains("hidden")) openImgPanel();
      else closeImgPanel();
    });

    // 패널 닫기
    $("#img-panel-close").addEventListener("click", closeImgPanel);

    // 첨부 버튼 → 파일 선택
    $("#img-upload-btn").addEventListener("click", () => {
      $("#img-file-input").click();
    });

    // 미리보기 영역 클릭 → 파일 선택
    $("#img-panel-preview").addEventListener("click", (e) => {
      if (e.target.closest("#img-delete-btn")) return;
      $("#img-file-input").click();
    });

    // 파일 입력 변경
    $("#img-file-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) processImageFile(file);
    });

    // 삭제
    $("#img-delete-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("내 이미지를 삭제하시겠습니까?")) return;
      await ImageStore.delete(_imgKey());
      showToast("이미지 삭제됨");
      await renderImgPanel();
      await updateImgBtnBadge();
      await updateVerseImage();
    });

    // 드래그 앤 드롭 (패널 미리보기 영역)
    const preview = $("#img-panel-preview");
    preview.addEventListener("dragover", (e) => {
      e.preventDefault();
      preview.classList.add("drag-over");
    });
    preview.addEventListener("dragleave", () => preview.classList.remove("drag-over"));
    preview.addEventListener("drop", (e) => {
      e.preventDefault();
      preview.classList.remove("drag-over");
      const file = e.dataTransfer.files[0];
      if (file) processImageFile(file);
    });

    // 클립보드 붙여넣기 (Ctrl+V / 모바일 paste)
    document.addEventListener("paste", async (e) => {
      if (imgPanel.classList.contains("hidden")) return;
      const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) { processImageFile(file); break; }
        }
      }
    });
  }

  // ===== 검색 기능 =====
  function bindSearchEvents() {
    const searchBtn     = $("#search-btn");
    const searchPanel   = $("#search-panel");
    const searchClose   = $("#search-close");
    const searchInput   = $("#search-input");
    const searchResults = $("#search-results");

    searchBtn.addEventListener("click", async () => {
      // 검색을 위해 모든 분기 데이터 사전 로드
      await Promise.all([
        DataLoader.load("2026"),
        DataLoader.load("yeongyeol")
      ]);
      rebuildUserVerses();

      // 검색 버튼 아래 드롭다운 위치 (좌우 100%)
      const searchContent = document.getElementById("search-dropdown-content");
      const sRect = searchBtn.getBoundingClientRect();
      searchContent.style.marginTop   = sRect.bottom + "px";
      searchContent.style.marginLeft  = "0";
      searchContent.style.marginRight = "0";

      searchPanel.classList.remove("hidden");
      setTimeout(() => searchInput.focus(), 100);
    });

    searchClose.addEventListener("click", () => searchPanel.classList.add("hidden"));

    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => performSearch(searchInput.value), 200);
    });

    searchResults.addEventListener("click", (e) => {
      const item = e.target.closest(".search-result-item");
      if (!item) return;
      const q = item.dataset.quarter;
      const l = parseInt(item.dataset.lesson);
      // 해당 분기/과로 이동
      navigateTo(q, l);
      searchPanel.classList.add("hidden");
    });
  }

  async function navigateTo(quarter, lesson) {
    if (state.quarter !== quarter) {
      state.quarter = quarter;
      quarterSelect.value = quarter;
      if (quarter === "user") {
        rebuildUserVerses();
      } else {
        await DataLoader.load(DataLoader.getYear(quarter));
      }
      applyTheme();
    }
    state.lesson = lesson;
    state.step = 1;
    state.showAll = false;
    resetWordStates();
    AudioManager.stop();
    render();
    saveState();
  }

  function performSearch(query) {
    const searchResults = $("#search-results");
    const q = (query || "").trim().toLowerCase();

    if (!q) {
      searchResults.innerHTML = `<div class="search-placeholder">검색어를 입력하세요</div>`;
      return;
    }

    const results = [];
    Object.entries(VERSES).forEach(([quarter, data]) => {
      if (!data || !data.lessons) return;
      data.lessons.forEach(lesson => {
        const verse = (lesson.verse.ko || "").toLowerCase();
        const ref   = (lesson.reference?.ko || "").toLowerCase();
        const title = (lesson.title?.ko || "").toLowerCase();
        const expl  = (lesson.explanation || "").toLowerCase();
        if (verse.includes(q) || ref.includes(q) || title.includes(q) || expl.includes(q)) {
          results.push({ quarter, lesson });
        }
      });
    });

    if (results.length === 0) {
      searchResults.innerHTML = `<div class="search-no-results">검색 결과가 없습니다<br><span style="font-size:12px;opacity:.7">"${query}"</span></div>`;
      return;
    }

    // 결과 렌더링 (최대 100개)
    const frag = document.createDocumentFragment();
    results.slice(0, 100).forEach(({ quarter, lesson }) => {
      const verseKo  = lesson.verse.ko || "";
      const ref      = lesson.reference?.ko || "";
      const qName    = getQuarterName(quarter);
      const badgeNum = lesson.badgeText || `제${lesson.lesson}과`;
      const snippet  = highlightQuery(verseKo.slice(0, 80) + (verseKo.length > 80 ? "…" : ""), q);

      const item = document.createElement("div");
      item.className = "search-result-item";
      item.dataset.quarter = quarter;
      item.dataset.lesson  = lesson.lesson;
      item.innerHTML = `
        <div class="search-result-quarter">${qName} · ${badgeNum}</div>
        <div class="search-result-ref">${ref}</div>
        <div class="search-result-snippet">${snippet}</div>`;
      frag.appendChild(item);
    });

    searchResults.innerHTML = "";
    searchResults.appendChild(frag);
  }

  function highlightQuery(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQ = escapeHtml(query);
    const re = new RegExp(`(${escapedQ.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return escaped.replace(re, "<mark>$1</mark>");
  }

  function escapeHtml(str) {
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
              .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  // ===== 사용자 성경절 관리 패널 =====
  let _editingId = null;
  let _pendingAudioBlob = null;
  let _pendingAudioDeleteId = null;
  let _recInterval = null;
  let _pendingMultilang = null; // 다국어 입력 파싱 결과 { verses:{ko,en,...}, refs:{ko,en,...} }

  // ── 언어 레이블 자동 인식 ──
  const LANG_DETECT = {
    ko: /개역한글|개역개정|새번역|공동번역|우리말성경|한국어/i,
    en: /nkjv|kjv\b|niv\b|esv\b|nasb|nlt\b|english|영어/i,
    zh: /중문|화간체|번체|chinese|简体|繁體/i,
    ja: /일본|일어|新改訳|新共同訳|japanese/i,
    in: /인도네시아|indonesian|tbi\b/i   // TBI = Terjemahan Baru Indonesia (PRS Bible)
  };
  function detectLangLabel(label) {
    for (const [lang, re] of Object.entries(LANG_DETECT)) {
      if (re.test(label)) return lang;
    }
    return null;
  }
  function parseBatchInput(text) {
    // 좌·우 큰따옴표(\u201C\u201D)와 일반 큰따옴표 모두 처리
    const normalized = text.replace(/[\u201C\u201D]/g, '"');
    const verses = {}, refs = {}, titles = {};
    let detectedTopic = null;

    // trailing 텍스트 처리: "주제어, 언어별제목" 또는 "주제어"
    // 구분자: 쉼표(,) — 어떤 형식이든 동일
    // 쉼표 앞 = 제1과(과 주제), 쉼표 뒤 = 제목
    function parseTrailing(trailing, lang) {
      if (!trailing) return;
      const ci = trailing.indexOf(',');
      if (ci > -1) {
        const topicPart = trailing.substring(0, ci).trim();
        const titlePart = trailing.substring(ci + 1).trim();
        if (topicPart && !detectedTopic) detectedTopic = topicPart;
        if (titlePart && lang) titles[lang] = titlePart;
      } else {
        if (!detectedTopic) detectedTopic = trailing.trim();
      }
    }

    for (const line of normalized.split('\n').map(l => l.trim()).filter(l => l)) {
      let m;

      // 형식 A — 맥 베들레헴: [언어레이블] 구절내용 (참조) 주제어[, 언어별제목]
      // 예: [개역한글] 또 내가... (눅 12:19) 자만, 많이 쌓아 두었으니
      if (line.startsWith('[')) {
        m = /^\[([^\]]+)\]\s*(.+)\s*\(([^)]+)\)\s*(.*)/.exec(line);
        if (m) {
          const lang = detectLangLabel(m[1].trim());
          if (lang && !verses[lang]) {
            verses[lang] = m[2].trim();
            refs[lang]   = m[3].trim();
            parseTrailing(m[4]?.trim(), lang);
            continue;
          }
        }
      }

      // 형식 B — 베들레헴 성경: "구절내용" (참조, 언어레이블) 주제어[, 언어별제목]
      // 예: "And I will say to my soul, "Soul, you have...merry.""(눅 12:19, ESV)
      // ※ .+ 탐욕적 매칭으로 내부 "..." 중첩 따옴표 지원
      if (line.startsWith('"')) {
        m = /^"(.+)"\s*\(([^,)]+),\s*([^)]+)\)\s*(.*)/.exec(line);
        if (m) {
          const lang = detectLangLabel(m[3].trim());
          if (lang && !verses[lang]) {
            verses[lang] = m[1].trim();
            refs[lang]   = m[2].trim();
            parseTrailing(m[4]?.trim(), lang);
            continue;
          }
        }
      }

      // 형식 C — PRS Bible 등: 구절내용 (참조, 언어코드) 주제어[, 언어별제목]
      // 예: 구절본문 (눅 12:19, 인도네시아) 자만, banyak barang
      m = /^(.+?)\s*\(([^,)]+),\s*([^)]+)\)\s*(.*)/.exec(line);
      if (m) {
        const lang = detectLangLabel(m[3].trim());
        if (lang && !verses[lang]) {
          verses[lang] = m[1].trim();
          refs[lang]   = m[2].trim();
          parseTrailing(m[4]?.trim(), lang);
        }
      }
    }

    return Object.keys(verses).length
      ? { verses, refs, topic: detectedTopic,
          titles: Object.keys(titles).length ? titles : null }
      : null;
  }
  function renderBatchPreview(data) {
    const preview = $("#batch-preview");
    if (!data || !Object.keys(data.verses).length) { preview.classList.add("hidden"); return; }
    const flags = { ko:"🇰🇷", en:"🇺🇸", ja:"🇯🇵", zh:"🇨🇳", in:"🇮🇩" };
    let html = "";
    // 공통 주제어 + 언어별 제목 안내
    if (data.topic) {
      html += `<div class="bp-topic-row">📌 주제: <strong>${data.topic}</strong></div>`;
    }
    html += '<div class="batch-preview-list">';
    for (const lang of ["ko","en","zh","ja","in"]) {
      if (data.verses[lang]) {
        const v = data.verses[lang];
        const short = v.length > 32 ? v.substring(0, 32) + "…" : v;
        const titleStr = data.titles?.[lang] ? `<span class="bp-title"> · ${data.titles[lang]}</span>` : "";
        html += `<div class="batch-preview-item">
          <span class="bp-flag">${flags[lang]}</span>
          <span class="bp-ref">${data.refs[lang] || ""}</span>${titleStr}
          <span class="bp-verse">${short}</span>
        </div>`;
      }
    }
    html += "</div>";
    preview.innerHTML = html;
    preview.classList.remove("hidden");
  }
  function switchFormMode(mode) {
    const isSingle = mode === "single";
    $("#mode-single").classList.toggle("active", isSingle);
    $("#mode-multi").classList.toggle("active", !isSingle);
    $("#single-mode-fields").classList.toggle("hidden", !isSingle);
    $("#multi-mode-fields").classList.toggle("hidden", isSingle);
    if (isSingle) { _pendingMultilang = null; $("#batch-preview").classList.add("hidden"); }
  }

  const UV_SORT_KEY = "bible-uv-sort";
  function _uvSortOrder() {
    return localStorage.getItem(UV_SORT_KEY) || "alpha";
  }
  function _uvSortApply(order) {
    localStorage.setItem(UV_SORT_KEY, order);
    $("#uv-sort-alpha")?.classList.toggle("active", order === "alpha");
    $("#uv-sort-recent")?.classList.toggle("active", order === "recent");
    // 본문(VERSES["user"])도 새 순서로 재빌드
    rebuildUserVerses();
    // 현재 사용자 성경절 보기 중이면 1과로 이동 후 렌더
    if (state.quarter === "user") { state.lesson = 1; render(); }
    renderUserVerseList();
  }

  function renderUserVerseList() {
    const list = $("#user-verse-list");
    const order = _uvSortOrder();
    // 정렬 버튼 상태 동기화
    $("#uv-sort-alpha")?.classList.toggle("active", order === "alpha");
    $("#uv-sort-recent")?.classList.toggle("active", order === "recent");
    const verses = UserVerseManager.getSorted(order);
    if (verses.length === 0) {
      list.innerHTML = `<div class="uv-empty">아직 등록된 성경절이 없습니다.<br>아래 버튼으로 추가해 보세요.</div>`;
      return;
    }
    list.innerHTML = "";
    verses.forEach(v => {
      const item = document.createElement("div");
      item.className = "user-verse-item";
      const flagMap = { ko:"🇰🇷", en:"🇺🇸", ja:"🇯🇵", zh:"🇨🇳", in:"🇮🇩" };
      const langFlag = (v.multilang && v.verses)
        ? ["ko","en","zh","ja","in"].filter(l => v.verses[l]).map(l => flagMap[l]).join("")
        : (flagMap[v.lang] || "");
      item.innerHTML = `
        <div class="uv-info">
          <div class="uv-topic">${v.topic}</div>
          <div class="uv-meta">${langFlag} ${v.reference}${v.hasAudio ? " 🎵" : ""}</div>
        </div>
        <button class="uv-edit-btn" data-id="${v.id}" title="편집">✏️</button>
        <button class="uv-del-btn"  data-id="${v.id}" title="삭제">🗑</button>`;
      list.appendChild(item);
    });
  }

  function openVerseForm(id = null) {
    _editingId = id;
    _pendingAudioBlob = null;
    _pendingAudioDeleteId = null;
    _pendingMultilang = null;
    clearRecTimer();

    const v = id ? UserVerseManager.load().find(x => x.id === id) : null;
    $("#form-panel-title").textContent = id ? "성경절 편집" : "성경절 추가";
    $("#f-topic").value = v ? v.topic : "";

    if (v && v.multilang && v.verses) {
      // 다국어 모드로 열기 — 저장된 데이터를 배치 텍스트로 복원
      switchFormMode("multi");
      const labelMap = { ko:"개역한글", en:"NKJV", zh:"중문화간체", ja:"일본신개역", in:"인도네시아" };
      let batchText = "";
      for (const lang of ["ko","en","zh","ja","in"]) {
        if (v.verses[lang]) {
          // 주제어 + 언어별 제목 복원: "주제어, 언어별제목" 또는 "주제어"
          let trailing = v.topic || "";
          if (v.titles?.[lang]) trailing += `, ${v.titles[lang]}`;
          const trailingStr = trailing ? ` ${trailing}` : "";
          batchText += `"${v.verses[lang]}" (${v.refs?.[lang] || v.reference}, ${labelMap[lang]})${trailingStr}\n\n`;
        }
      }
      $("#f-batch").value = batchText.trim();
      _pendingMultilang = { verses: { ...v.verses }, refs: { ...(v.refs || {}) }, titles: v.titles ? { ...v.titles } : null };
      renderBatchPreview(_pendingMultilang);
    } else {
      // 단일 언어 모드
      switchFormMode("single");
      $("#f-lang").value  = v ? v.lang      : "ko";
      $("#f-ref").value   = v ? v.reference : "";
      $("#f-verse").value = v ? v.verse     : "";
      $("#f-batch").value = "";
    }

    showAudioState(v && v.hasAudio ? "preview-existing" : "none");
    if (v && v.hasAudio) {
      AudioStore.getURL(v.id).then(url => {
        if (url) $("#preview-audio").src = url;
      });
    } else {
      $("#preview-audio").src = "";
    }

    $("#user-form-panel").classList.remove("hidden");
  }

  function showAudioState(aState) {
    $("#audio-no").classList.toggle("hidden",       aState !== "none");
    $("#audio-recording").classList.toggle("hidden",aState !== "recording");
    $("#audio-preview").classList.toggle("hidden",  aState !== "preview-new" && aState !== "preview-existing");
  }

  async function saveVerseForm() {
    const topic = $("#f-topic").value.trim() || "미분류";
    const isMultiMode = !$("#multi-mode-fields").classList.contains("hidden");
    let saveData;

    if (isMultiMode) {
      if (!_pendingMultilang || !Object.keys(_pendingMultilang.verses).length) {
        alert("성경절을 붙여넣고 [🔍 언어 자동 인식]을 눌러 주세요."); return;
      }
      const primaryLang = ["ko","en","zh","ja","in"].find(l => _pendingMultilang.verses[l]) || "ko";
      saveData = {
        topic,
        lang:      primaryLang,
        reference: _pendingMultilang.refs[primaryLang] || "",
        verse:     _pendingMultilang.verses[primaryLang] || "",
        multilang: true,
        verses:    _pendingMultilang.verses,
        refs:      _pendingMultilang.refs,
        titles:    _pendingMultilang.titles || null
      };
    } else {
      const ref   = $("#f-ref").value.trim();
      const verse = $("#f-verse").value.trim();
      if (!verse) { alert("성경절 내용을 입력해 주세요."); return; }
      saveData = { topic, lang: $("#f-lang").value, reference: ref, verse, multilang: false, verses: null, refs: null };
    }

    if (_editingId) {
      if (_pendingAudioDeleteId) {
        await AudioStore.delete(_pendingAudioDeleteId);
        UserVerseManager.update(_editingId, { hasAudio: false });
        _pendingAudioDeleteId = null;
      }
      if (_pendingAudioBlob) {
        await AudioStore.save(_editingId, _pendingAudioBlob);
        UserVerseManager.update(_editingId, { hasAudio: true });
        _pendingAudioBlob = null;
      }
      UserVerseManager.update(_editingId, saveData);
    } else {
      const newV = UserVerseManager.add(saveData);
      if (_pendingAudioBlob) {
        await AudioStore.save(newV.id, _pendingAudioBlob);
        UserVerseManager.update(newV.id, { hasAudio: true });
        _pendingAudioBlob = null;
      }
    }

    rebuildUserVerses();
    if (state.quarter === "user") { state.lesson = 1; render(); }
    renderUserVerseList();
    $("#user-form-panel").classList.add("hidden");
  }

  function clearRecTimer() {
    if (_recInterval) { clearInterval(_recInterval); _recInterval = null; }
  }

  function startRecTimer() {
    let sec = 0;
    const el = $("#rec-timer");
    el.textContent = "00:00";
    _recInterval = setInterval(() => {
      sec++;
      const m = String(Math.floor(sec/60)).padStart(2,"0");
      const s = String(sec%60).padStart(2,"0");
      el.textContent = `${m}:${s}`;
    }, 1000);
  }

  function bindUserPanelEvents() {
    // 사용자 성경절 목록 (이벤트 위임)
    $("#user-verse-list").addEventListener("click", async (e) => {
      const editBtn = e.target.closest(".uv-edit-btn");
      const delBtn  = e.target.closest(".uv-del-btn");
      if (editBtn) { openVerseForm(editBtn.dataset.id); }
      if (delBtn) {
        const id = delBtn.dataset.id;
        const v  = UserVerseManager.load().find(x => x.id === id);
        if (!confirm(`"${v?.topic}" 를 삭제하시겠습니까?`)) return;
        if (v?.hasAudio) await AudioStore.delete(id);
        UserVerseManager.delete(id);
        rebuildUserVerses();
        if (state.quarter === "user") { state.lesson = Math.max(1, state.lesson - 1); render(); }
        renderUserVerseList();
      }
    });

    // 정렬 토글 버튼
    $("#uv-sort-alpha").addEventListener("click",  () => _uvSortApply("alpha"));
    $("#uv-sort-recent").addEventListener("click", () => _uvSortApply("recent"));

    // 새 추가 버튼
    $("#add-verse-btn").addEventListener("click", () => openVerseForm(null));

    // 폼 패널
    $("#user-form-close").addEventListener("click", () => {
      $("#user-form-panel").classList.add("hidden");
    });
    $("#form-cancel-btn").addEventListener("click", () => {
      $("#user-form-panel").classList.add("hidden");
    });
    $("#form-save-btn").addEventListener("click", saveVerseForm);

    // 입력 모드 전환
    $("#mode-single").addEventListener("click", () => switchFormMode("single"));
    $("#mode-multi").addEventListener("click", () => {
      switchFormMode("multi");
      // 배치 textarea가 비어있고 편집 중인 성경절이 있으면 기존 단일언어 데이터로 사전 입력
      if (!$("#f-batch").value.trim() && _editingId) {
        const v = UserVerseManager.load().find(x => x.id === _editingId);
        if (v) {
          if (v.multilang && v.verses) {
            // 다국어 데이터가 있는 경우 — 전체 배치 텍스트 재구성 (제목 포함)
            const labelMap = { ko:"개역한글", en:"NKJV", zh:"중문화간체", ja:"일본신개역", in:"인도네시아" };
            let batchText = "";
            for (const lang of ["ko","en","zh","ja","in"]) {
              if (v.verses[lang]) {
                let trailing = v.topic || "";
                if (v.titles?.[lang]) trailing += `, ${v.titles[lang]}`;
                const trailingStr = trailing ? ` ${trailing}` : "";
                batchText += `"${v.verses[lang]}" (${v.refs?.[lang] || v.reference}, ${labelMap[lang]})${trailingStr}\n\n`;
              }
            }
            $("#f-batch").value = batchText.trim();
            _pendingMultilang = { verses: { ...v.verses }, refs: { ...(v.refs || {}) }, titles: v.titles ? { ...v.titles } : null };
            renderBatchPreview(_pendingMultilang);
          } else if (v.verse) {
            // 단일언어 데이터만 있는 경우 — 해당 언어 1개만 사전 입력
            const labelMap = { ko:"개역한글", en:"NKJV", zh:"중문화간체", ja:"일본신개역", in:"인도네시아" };
            const label = labelMap[v.lang] || v.lang;
            $("#f-batch").value = `"${v.verse}" (${v.reference}, ${label})`;
          }
        }
      }
    });

    // 다국어 일괄 파싱
    $("#batch-parse-btn").addEventListener("click", () => {
      const text = $("#f-batch").value;
      const result = parseBatchInput(text);
      const preview = $("#batch-preview");
      if (!result) {
        preview.innerHTML = '<div class="batch-error">⚠ 인식된 성경절이 없습니다.<br><small>"구절" (장절, 언어) 형식을 확인해 주세요.</small></div>';
        preview.classList.remove("hidden");
        _pendingMultilang = null;
        return;
      }
      _pendingMultilang = result;
      // 주제어가 감지되었고 주제 입력란이 비어있으면 자동 입력
      if (result.topic && !$("#f-topic").value.trim()) {
        $("#f-topic").value = result.topic;
      }
      renderBatchPreview(result);
    });

    // 녹음 시작
    $("#record-btn").addEventListener("click", async () => {
      try {
        await VoiceRecorder.start();
        showAudioState("recording");
        startRecTimer();
      } catch(e) {
        alert("마이크 접근 권한이 필요합니다.\n" + e.message);
      }
    });

    // 녹음 중지
    $("#record-stop-btn").addEventListener("click", async () => {
      clearRecTimer();
      const blob = await VoiceRecorder.stop();
      if (blob) {
        _pendingAudioBlob = blob;
        const url = URL.createObjectURL(blob);
        $("#preview-audio").src = url;
        showAudioState("preview-new");
      } else {
        showAudioState("none");
      }
    });

    // 파일 첨부
    $("#attach-btn").addEventListener("click", () => $("#audio-file-input").click());
    $("#audio-file-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      _pendingAudioBlob = file;
      const url = URL.createObjectURL(file);
      $("#preview-audio").src = url;
      showAudioState("preview-new");
      e.target.value = "";
    });

    // 오디오 삭제
    $("#audio-delete-btn").addEventListener("click", () => {
      if (_editingId) _pendingAudioDeleteId = _editingId;
      _pendingAudioBlob = null;
      $("#preview-audio").src = "";
      showAudioState("none");
    });

    // 전체 백업 내보내기
    $("#export-btn").addEventListener("click", () => DataExchange.exportZIP());

    // 전체 백업 가져오기
    $("#import-btn").addEventListener("click", () => $("#import-file-input").click());
    $("#import-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = "";
      await DataExchange.importZIP(file, async (result) => {
        rebuildUserVerses();
        HighlightManager.load();

        // 복원된 모듈 데이터를 VERSES에 로드 + 드롭다운 재빌드
        if (result?.restoredModuleIds?.length > 0) {
          for (const moduleId of result.restoredModuleIds) {
            try {
              const mod = ModuleManager.getModule(moduleId);
              if (mod?.type === "quarterly") {
                // 내장 분기별 모듈: data = { "2026-01": {...}, "2026-02": {...} }
                const data = await ModuleManager.getModuleData(moduleId);
                if (data) Object.assign(VERSES, data);
              } else {
                // 커스텀 모듈(topic/custom): data = { theme, title, lessons }
                // → VERSES[moduleId]에 직접 할당
                await DataLoader.loadInstalledModule(moduleId);
              }
            } catch(e) {
              console.warn("[importZIP] VERSES 로드 실패:", moduleId, e);
            }
          }
          rebuildQuarterSelect();
          renderModuleTab();
        }

        // 형광펜 복원 후 현재 화면에도 즉시 반영
        HighlightManager.load();
        render();

        if (state.quarter === "user") { state.lesson = 1; }
        renderUserVerseList();
        const modCount = result?.restoredModuleIds?.length || 0;
        showToast(`✅ 가져오기 완료${modCount ? " · 모듈 " + modCount + "개 복원" : ""}`);
      });
    });

    // 내성경절 전용 내보내기 (JSON)
    $("#user-export-btn").addEventListener("click", () => DataExchange.exportVerses());

    // 내성경절 전용 가져오기 (JSON)
    $("#user-import-btn").addEventListener("click", () => $("#user-import-file-input").click());
    $("#user-import-file-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = "";
      await DataExchange.importVerses(file, () => {
        rebuildUserVerses();
        if (state.quarter === "user") { state.lesson = 1; render(); }
        renderUserVerseList();
        alert("가져오기 완료!");
      });
    });

    // 내성경절 부가 데이터 초기화 (형광펜·즐겨찾기·암기체크)
    const auxClearBtn = $("#user-aux-clear-btn");
    if (auxClearBtn) {
      auxClearBtn.addEventListener("click", () => {
        const ok = confirm(
          "내성경절의 부가 데이터(형광펜·즐겨찾기·암기체크)를 모두 초기화합니다.\n\n" +
          "성경절 본문은 그대로 유지됩니다.\n계속하시겠습니까?"
        );
        if (!ok) return;
        clearUserAuxData();
        rebuildFavorites();
        if (state.quarter === "favorites") { state.lesson = 1; }
        render();
        renderUserVerseList();
        alert("초기화 완료!");
      });
    }

    // ── 전체 초기화 버튼 ────────────────────────────────────────
    const resetModal   = document.getElementById("reset-modal");
    const resetAllBtn  = document.getElementById("reset-all-btn");
    const resetCancel  = document.getElementById("reset-modal-cancel");
    const resetConfirm = document.getElementById("reset-modal-confirm");

    // 초기화 버튼 클릭 → 모달 표시
    resetAllBtn?.addEventListener("click", () => {
      resetModal?.classList.remove("hidden");
    });

    // 취소
    resetCancel?.addEventListener("click", () => {
      resetModal?.classList.add("hidden");
    });

    // 모달 배경 클릭 → 취소
    resetModal?.addEventListener("click", (e) => {
      if (e.target === resetModal) resetModal.classList.add("hidden");
    });

    // 삭제 확인 → 전체 초기화
    resetConfirm?.addEventListener("click", async () => {
      resetConfirm.disabled = true;
      resetConfirm.textContent = "삭제 중…";

      try {
        // 1. localStorage 전체 키 삭제
        const lsKeys = [
          "bible-memory-state", "bible-memory-highlights", "bible-memo-log",
          "bible-favorites", "bible-user-verses", "bible-user-profile",
          "bible-module-registry", "bible-font", "bible-font-size", "bible-hl-custom"
        ];
        lsKeys.forEach(k => localStorage.removeItem(k));

        // 2. IndexedDB 데이터베이스 삭제
        const dbNames = ["bible-modules", "bible-user-audio", "bible-user-images"];
        await Promise.all(dbNames.map(name => new Promise((resolve) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = resolve;
          req.onerror   = resolve; // 오류여도 계속 진행
          req.onblocked = resolve;
        })));

        // 3. 서비스 워커 캐시 삭제 (있는 경우)
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }

        // 4. 완료 메시지 후 페이지 새로고침
        resetConfirm.textContent = "✅ 완료 — 재시작 중…";
        setTimeout(() => { location.reload(); }, 800);

      } catch (err) {
        console.error("초기화 오류:", err);
        resetConfirm.disabled = false;
        resetConfirm.textContent = "⚠ 오류 — 다시 시도";
        showToast("⚠ 초기화 중 오류가 발생했습니다: " + err.message);
      }
    });
  }

  // ===== 시작 =====
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
