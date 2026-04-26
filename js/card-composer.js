// ============================================================================
// CardComposer - 사진/배경 위에 성경절을 얹은 카드 이미지 생성기
// ----------------------------------------------------------------------------
// · Canvas 2D API 직접 렌더링 (외부 라이브러리 의존성 없음)
// · 배경: 사진첩 / URL / 그라디언트 프리셋
// · 텍스트: 드래그로 위치 조정, 슬라이더로 크기·오버레이 조정
// · 템플릿 5종, 1:1 / 4:5 비율 토글
// · 저장: PNG 다운로드 + Web Share API (카톡 등)
// ============================================================================

const CardComposer = (() => {
  // ── 상수 ────────────────────────────────────────────────────────────────
  const RATIOS = {
    "1:1": { w: 1080, h: 1080 },
    "4:5": { w: 1080, h: 1350 },
    "9:16": { w: 1080, h: 1920 },
  };

  const GRADIENTS = [
    { id: "g-night",  name: "밤",     stops: ["#1a1a2e", "#16213e", "#0f3460"] },
    { id: "g-dawn",   name: "여명",   stops: ["#2c3e50", "#fd746c"] },
    { id: "g-gold",   name: "황금",   stops: ["#3a2e0e", "#7a5c1e", "#c9a84c"] },
    { id: "g-sea",    name: "바다",   stops: ["#0f2027", "#203a43", "#2c5364"] },
    { id: "g-forest", name: "숲",     stops: ["#134e5e", "#71b280"] },
    { id: "g-purple", name: "보라",   stops: ["#1a0033", "#3d1466", "#7b2cbf"] },
  ];

  const TEMPLATES = [
    {
      id: "tpl-bottom",  name: "하단 인용",
      verse:  { yRel: 0.62, fontSize: 56, color: "#ffffff", align: "left", weight: 500 },
      ref:    { yRel: 0.92, fontSize: 32, color: "#c9a84c", align: "left" },
      overlay: 0.45,
    },
    {
      id: "tpl-center",  name: "중앙 강조",
      verse:  { yRel: 0.42, fontSize: 64, color: "#ffffff", align: "center", weight: 600 },
      ref:    { yRel: 0.85, fontSize: 30, color: "#c9a84c", align: "center" },
      overlay: 0.55,
    },
    {
      id: "tpl-top",     name: "상단 헤드라인",
      verse:  { yRel: 0.10, fontSize: 60, color: "#ffffff", align: "left", weight: 600 },
      ref:    { yRel: 0.92, fontSize: 28, color: "#c9a84c", align: "right" },
      overlay: 0.40,
    },
    {
      id: "tpl-quote",   name: "인용부호",
      verse:  { yRel: 0.50, fontSize: 60, color: "#ffffff", align: "center", weight: 500, quote: true },
      ref:    { yRel: 0.88, fontSize: 30, color: "#c9a84c", align: "center" },
      overlay: 0.50,
    },
    {
      id: "tpl-clean",   name: "오버레이 없음",
      verse:  { yRel: 0.78, fontSize: 52, color: "#ffffff", align: "left", weight: 600, shadow: true },
      ref:    { yRel: 0.92, fontSize: 28, color: "#ffffff", align: "left", shadow: true },
      overlay: 0,
    },
  ];

  // ── 상태 ────────────────────────────────────────────────────────────────
  const state = {
    ratio: "4:5",
    bg: {
      type: "gradient",    // "image" | "gradient"
      image: null,         // HTMLImageElement
      imageUrl: null,
      gradient: GRADIENTS[0],
      scale: 1.0,
      offsetX: 0,
      offsetY: 0,
    },
    overlay: 0.45,
    verse: {
      text: "",
      x: null, y: null,    // null → 템플릿 기본값 사용
      fontSize: 56,
      color: "#ffffff",
      align: "left",
      weight: 500,
      quote: false,
      shadow: false,
      lineHeight: 1.4,
    },
    ref: {
      text: "",
      x: null, y: null,
      fontSize: 32,
      color: "#c9a84c",
      align: "left",
      shadow: false,
    },
    watermark: { text: "", show: true },
    template: TEMPLATES[0],
  };

  // ── DOM ─────────────────────────────────────────────────────────────────
  let panel, canvas, ctx, statusEl;
  let drag = null;

  function $(sel, root = document) { return root.querySelector(sel); }

  // ── 초기화 ──────────────────────────────────────────────────────────────
  function init() {
    panel = $("#card-composer-panel");
    if (!panel) return;
    canvas = $("#cc-canvas");
    ctx = canvas.getContext("2d");
    statusEl = $("#cc-status");

    bindEvents();
    renderTemplateChips();
    renderGradientChips();
  }

  // ── 열기/닫기 ───────────────────────────────────────────────────────────
  function open(opts) {
    if (!panel) init();
    const verse = (opts && opts.verseText) || "";
    const ref = (opts && opts.verseRef) || "";
    const wmName = (opts && opts.userName) || "";

    state.verse.text = verse;
    state.ref.text = ref;
    state.watermark.text = wmName;

    applyTemplate(TEMPLATES[0]);
    resizeCanvas();
    redraw();

    // 폼 동기화
    $("#cc-verse-input").value = verse;
    $("#cc-ref-input").value = ref;
    $("#cc-overlay-slider").value = Math.round(state.overlay * 100);
    $("#cc-fontsize-slider").value = state.verse.fontSize;
    $("#cc-watermark-toggle").checked = state.watermark.show;
    updateRatioButtons();

    panel.classList.remove("hidden");
  }

  function close() {
    if (panel) panel.classList.add("hidden");
  }

  // ── 템플릿 적용 ─────────────────────────────────────────────────────────
  function applyTemplate(tpl) {
    state.template = tpl;
    state.overlay = tpl.overlay;
    Object.assign(state.verse, {
      x: null, y: null,
      fontSize: tpl.verse.fontSize,
      color: tpl.verse.color,
      align: tpl.verse.align,
      weight: tpl.verse.weight,
      quote: !!tpl.verse.quote,
      shadow: !!tpl.verse.shadow,
    });
    Object.assign(state.ref, {
      x: null, y: null,
      fontSize: tpl.ref.fontSize,
      color: tpl.ref.color,
      align: tpl.ref.align,
      shadow: !!tpl.ref.shadow,
    });
    // UI 동기화
    if ($("#cc-overlay-slider")) $("#cc-overlay-slider").value = Math.round(tpl.overlay * 100);
    if ($("#cc-fontsize-slider")) $("#cc-fontsize-slider").value = tpl.verse.fontSize;
    document.querySelectorAll(".cc-tpl-chip").forEach(el => {
      el.classList.toggle("active", el.dataset.id === tpl.id);
    });
  }

  // ── 캔버스 사이즈 ───────────────────────────────────────────────────────
  function resizeCanvas() {
    const r = RATIOS[state.ratio];
    canvas.width = r.w;
    canvas.height = r.h;
  }

  // ── 렌더 ────────────────────────────────────────────────────────────────
  function redraw() {
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // 배경
    drawBackground(W, H);
    // 오버레이
    if (state.overlay > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${state.overlay})`;
      ctx.fillRect(0, 0, W, H);
    }
    // 본문
    drawVerseText(W, H);
    // 참조
    drawRefText(W, H);
    // 워터마크
    if (state.watermark.show && state.watermark.text) {
      drawWatermark(W, H);
    }
  }

  function drawBackground(W, H) {
    if (state.bg.type === "image" && state.bg.image) {
      const img = state.bg.image;
      // ImageBitmap proxy 처리: drawImage 의 실제 인자는 _bmp
      const drawable = img._bmp || img;
      const iw = img.naturalWidth || img.width || drawable.width;
      const ih = img.naturalHeight || img.height || drawable.height;
      // cover fit
      const sBase = Math.max(W / iw, H / ih);
      const s = sBase * state.bg.scale;
      const dw = iw * s, dh = ih * s;
      const dx = (W - dw) / 2 + state.bg.offsetX;
      const dy = (H - dh) / 2 + state.bg.offsetY;
      ctx.drawImage(drawable, dx, dy, dw, dh);
    } else {
      // 그라디언트
      const g = state.bg.gradient;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      g.stops.forEach((c, i) => {
        grad.addColorStop(g.stops.length === 1 ? 0 : i / (g.stops.length - 1), c);
      });
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function fontStack() {
    return `'Noto Sans KR', 'Noto Sans', system-ui, sans-serif`;
  }

  function drawVerseText(W, H) {
    if (!state.verse.text) return;
    const v = state.verse;
    const padX = W * 0.08;
    const maxWidth = W - padX * 2;
    ctx.font = `${v.weight} ${v.fontSize}px ${fontStack()}`;
    ctx.fillStyle = v.color;
    ctx.textAlign = v.align;
    ctx.textBaseline = "top";

    if (v.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }

    const lines = wrapText(ctx, v.text, maxWidth);
    const lineH = v.fontSize * v.lineHeight;
    const totalH = lines.length * lineH;

    // 위치 결정: 사용자 드래그 위치 우선, 없으면 템플릿 yRel
    let x = (v.x !== null) ? v.x : (v.align === "center" ? W / 2 : v.align === "right" ? W - padX : padX);
    let y = (v.y !== null) ? v.y : (state.template.verse.yRel * H);

    // 인용부호
    if (v.quote) {
      ctx.save();
      ctx.font = `bold ${v.fontSize * 1.6}px ${fontStack()}`;
      ctx.fillStyle = v.color;
      ctx.globalAlpha = 0.45;
      const qx = v.align === "center" ? W / 2 - (maxWidth / 2) : x - 6;
      ctx.fillText("\u201C", qx, y - v.fontSize * 0.7);
      ctx.restore();
    }

    lines.forEach((line, i) => {
      ctx.fillText(line, x, y + i * lineH);
    });

    // 드래그 히트영역 저장
    state.verse._bbox = computeBBox(x, y, totalH, maxWidth, v.align, padX, W);

    // 그림자 리셋
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  }

  function drawRefText(W, H) {
    if (!state.ref.text) return;
    const r = state.ref;
    const padX = W * 0.08;
    ctx.font = `600 ${r.fontSize}px ${fontStack()}`;
    ctx.fillStyle = r.color;
    ctx.textAlign = r.align;
    ctx.textBaseline = "top";

    if (r.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.65)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 3;
    } else {
      ctx.shadowColor = "transparent";
    }

    let x = (r.x !== null) ? r.x : (r.align === "center" ? W / 2 : r.align === "right" ? W - padX : padX);
    let y = (r.y !== null) ? r.y : (state.template.ref.yRel * H);
    ctx.fillText(r.text, x, y);

    state.ref._bbox = computeBBox(x, y, r.fontSize * 1.2, W - padX * 2, r.align, padX, W);

    ctx.shadowColor = "transparent";
  }

  function drawWatermark(W, H) {
    const txt = `— ${state.watermark.text}`;
    ctx.font = `400 ${Math.round(W * 0.022)}px ${fontStack()}`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(txt, W - W * 0.05, H - H * 0.025);
  }

  function computeBBox(x, y, h, maxW, align, padX, W) {
    let bx = x;
    if (align === "center") bx = padX;
    else if (align === "right") bx = W - padX - maxW;
    return { x: bx, y, w: maxW, h };
  }

  function wrapText(ctx, text, maxWidth) {
    const out = [];
    text.split(/\n/).forEach(paragraph => {
      // 한국어는 어절 단위, 한자/일본어는 문자 단위 fallback
      const words = paragraph.split(/(\s+)/);
      let line = "";
      words.forEach(w => {
        const test = line + w;
        if (ctx.measureText(test).width > maxWidth && line) {
          out.push(line.trim());
          line = w.trim() ? w : "";
        } else {
          line = test;
        }
      });
      if (line.trim()) out.push(line.trim());
      if (!paragraph.trim()) out.push("");
    });
    return out;
  }

  // ── 이벤트 바인딩 ───────────────────────────────────────────────────────
  function bindEvents() {
    $("#cc-close").addEventListener("click", close);
    panel.addEventListener("click", (e) => {
      if (e.target === panel) close();
    });

    // 비율 토글
    panel.querySelectorAll(".cc-ratio-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        state.ratio = btn.dataset.ratio;
        // 텍스트 위치는 비율 변경 시 리셋 (템플릿 yRel 재적용)
        state.verse.x = state.verse.y = null;
        state.ref.x = state.ref.y = null;
        resizeCanvas();
        redraw();
        updateRatioButtons();
      });
    });

    // 본문/참조 입력
    $("#cc-verse-input").addEventListener("input", (e) => {
      state.verse.text = e.target.value;
      redraw();
    });
    $("#cc-ref-input").addEventListener("input", (e) => {
      state.ref.text = e.target.value;
      redraw();
    });

    // 오버레이 슬라이더
    $("#cc-overlay-slider").addEventListener("input", (e) => {
      state.overlay = parseInt(e.target.value, 10) / 100;
      redraw();
    });

    // 폰트 크기 슬라이더
    $("#cc-fontsize-slider").addEventListener("input", (e) => {
      state.verse.fontSize = parseInt(e.target.value, 10);
      redraw();
    });

    // 색상 토글
    panel.querySelectorAll(".cc-color-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        state.verse.color = btn.dataset.color;
        panel.querySelectorAll(".cc-color-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        redraw();
      });
    });

    // 정렬 토글
    panel.querySelectorAll(".cc-align-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        state.verse.align = btn.dataset.align;
        state.verse.x = null;
        panel.querySelectorAll(".cc-align-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        redraw();
      });
    });

    // 워터마크
    $("#cc-watermark-toggle").addEventListener("change", (e) => {
      state.watermark.show = e.target.checked;
      redraw();
    });

    // 사진 선택
    $("#cc-bg-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = "";
      await loadBgFromBlob(file);
    });
    $("#cc-bg-pick-btn").addEventListener("click", () => $("#cc-bg-file").click());

    // URL 로드
    $("#cc-bg-url-btn").addEventListener("click", async () => {
      const url = ($("#cc-bg-url-input").value || "").trim();
      if (!url) return;
      await loadBgFromUrl(url);
    });

    // 배경 줌
    $("#cc-bg-zoom").addEventListener("input", (e) => {
      state.bg.scale = parseInt(e.target.value, 10) / 100;
      redraw();
    });

    // 캔버스 드래그 (텍스트 위치 조정)
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    // 저장 / 공유
    $("#cc-download-btn").addEventListener("click", () => exportImage("download"));
    $("#cc-share-btn").addEventListener("click", () => exportImage("share"));
  }

  function updateRatioButtons() {
    panel.querySelectorAll(".cc-ratio-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.ratio === state.ratio);
    });
  }

  function renderTemplateChips() {
    const wrap = $("#cc-template-list");
    wrap.innerHTML = TEMPLATES.map(t =>
      `<button type="button" class="cc-tpl-chip" data-id="${t.id}">${t.name}</button>`
    ).join("");
    wrap.querySelectorAll(".cc-tpl-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        const t = TEMPLATES.find(x => x.id === btn.dataset.id);
        if (t) { applyTemplate(t); redraw(); }
      });
    });
  }

  function renderGradientChips() {
    const wrap = $("#cc-gradient-list");
    wrap.innerHTML = GRADIENTS.map(g => {
      const css = `linear-gradient(180deg, ${g.stops.join(", ")})`;
      return `<button type="button" class="cc-grad-chip" data-id="${g.id}" style="background:${css}" title="${g.name}"></button>`;
    }).join("");
    wrap.querySelectorAll(".cc-grad-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        const g = GRADIENTS.find(x => x.id === btn.dataset.id);
        if (g) {
          state.bg.type = "gradient";
          state.bg.gradient = g;
          state.bg.image = null;
          state.bg.imageUrl = null;
          $("#cc-bg-zoom").value = 100;
          state.bg.scale = 1;
          state.bg.offsetX = state.bg.offsetY = 0;
          redraw();
        }
      });
    });
  }

  // ── 배경 이미지 로드 ────────────────────────────────────────────────────
  // 지원: 모든 브라우저 디코더블 포맷(JPG/PNG/WebP/GIF/AVIF/BMP/SVG)
  //      + HEIC/HEIF (자동으로 heic2any 라이브러리 lazy-load 후 JPEG 변환)
  async function loadBgFromBlob(blob) {
    showStatus("이미지 로딩 중...");
    try {
      let workingBlob = blob;
      const fileName = (blob && blob.name) || "";
      const isHeic = /\.(heic|heif)$/i.test(fileName)
                  || /^image\/heic|^image\/heif/i.test(blob.type || "");

      // HEIC/HEIF 라면 먼저 변환
      if (isHeic) {
        showStatus("HEIC 변환 중... (수 초 소요)");
        try {
          workingBlob = await convertHeicToJpeg(blob);
        } catch (heicErr) {
          console.error("HEIC convert error:", heicErr);
          showStatus("HEIC 변환 실패. 사진 앱에서 JPG로 내보내신 뒤 다시 시도해주세요.", 4500);
          return;
        }
      }

      // 1차 시도: Image 디코딩
      let img = null;
      const url = URL.createObjectURL(workingBlob);
      try {
        img = await loadImage(url);
      } catch (e1) {
        // 2차 시도: createImageBitmap (좀 더 다양한 포맷 지원)
        try {
          if (typeof createImageBitmap === "function") {
            const bmp = await createImageBitmap(workingBlob);
            img = bitmapToImageProxy(bmp);
          } else {
            throw e1;
          }
        } catch (e2) {
          // HEIC가 아닌데 디코딩 실패한 경우 → heic2any 로 한 번 더 시도
          if (!isHeic) {
            try {
              showStatus("이미지 변환 시도 중...");
              const converted = await convertHeicToJpeg(workingBlob);
              const url2 = URL.createObjectURL(converted);
              img = await loadImage(url2);
              URL.revokeObjectURL(url);
              state.bg.imageUrl = url2;
            } catch (e3) {
              URL.revokeObjectURL(url);
              throw e2;
            }
          } else {
            URL.revokeObjectURL(url);
            throw e2;
          }
        }
      }

      if (state.bg.imageUrl && state.bg.imageUrl.startsWith("blob:")) {
        URL.revokeObjectURL(state.bg.imageUrl);
      }
      state.bg.type = "image";
      state.bg.image = img;
      state.bg.imageUrl = state.bg.imageUrl || url;
      state.bg.scale = 1;
      state.bg.offsetX = state.bg.offsetY = 0;
      $("#cc-bg-zoom").value = 100;
      redraw();
      showStatus("이미지 적용됨", 1200);
    } catch (err) {
      console.error("loadBgFromBlob:", err);
      const msg = (err && err.message) ? `이미지 로드 실패: ${err.message}` : "이미지 로드 실패 (지원하지 않는 포맷)";
      showStatus(msg, 4000);
    }
  }

  // ── HEIC/HEIF → JPEG 변환 (heic2any 동적 로드) ─────────────────────────
  let _heic2anyLoading = null;
  function ensureHeic2Any() {
    if (typeof window.heic2any === "function") return Promise.resolve();
    if (_heic2anyLoading) return _heic2anyLoading;
    _heic2anyLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("heic2any 로드 실패 (네트워크 확인)"));
      document.head.appendChild(s);
    });
    return _heic2anyLoading;
  }

  async function convertHeicToJpeg(blob) {
    await ensureHeic2Any();
    const out = await window.heic2any({ blob, toType: "image/jpeg", quality: 0.92 });
    return Array.isArray(out) ? out[0] : out;
  }

  // ── ImageBitmap → Image-like proxy (drawImage 호환) ─────────────────────
  function bitmapToImageProxy(bmp) {
    // Canvas API 의 drawImage 는 ImageBitmap 도 그대로 받지만,
    // state 가 naturalWidth/Height 를 참조하므로 동일 인터페이스 객체로 래핑.
    return {
      naturalWidth: bmp.width,
      naturalHeight: bmp.height,
      _bmp: bmp,
      // drawImage 는 첫 인자에 ImageBitmap 직접 가능 → 별도 그리기 헬퍼 사용 안 함.
      // 단, 현재 drawBackground 가 img 를 그대로 drawImage 인자로 넘기므로 호환을 위해
      // toString 기반 판별 대신 아래 setter 처리.
    };
  }

  async function loadBgFromUrl(url) {
    showStatus("이미지 로딩 중...");
    try {
      const img = await loadImage(url, true);
      state.bg.type = "image";
      state.bg.image = img;
      state.bg.imageUrl = url;
      state.bg.scale = 1;
      state.bg.offsetX = state.bg.offsetY = 0;
      $("#cc-bg-zoom").value = 100;
      redraw();
      showStatus("이미지 적용됨", 1200);
    } catch (err) {
      console.error(err);
      showStatus("CORS 차단 또는 잘못된 URL — 다운로드 후 사진 선택을 사용해주세요", 3500);
    }
  }

  function loadImage(url, useCORS) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (useCORS) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // ── 드래그 ──────────────────────────────────────────────────────────────
  function canvasCoord(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    return { x, y };
  }

  function hitText(p) {
    // 본문 우선 검사
    const vb = state.verse._bbox;
    if (vb && p.x >= vb.x && p.x <= vb.x + vb.w && p.y >= vb.y - 20 && p.y <= vb.y + vb.h + 20) {
      return "verse";
    }
    const rb = state.ref._bbox;
    if (rb && p.x >= rb.x && p.x <= rb.x + rb.w && p.y >= rb.y - 20 && p.y <= rb.y + rb.h + 20) {
      return "ref";
    }
    return null;
  }

  function onPointerDown(e) {
    const p = canvasCoord(e);
    const target = hitText(p);
    if (target) {
      const layer = state[target];
      // 현재 위치를 명시 좌표로 고정
      const padX = canvas.width * 0.08;
      const align = layer.align;
      const xCur = (layer.x !== null) ? layer.x
        : (align === "center" ? canvas.width / 2 : align === "right" ? canvas.width - padX : padX);
      const yCur = (layer.y !== null) ? layer.y
        : (target === "verse" ? state.template.verse.yRel * canvas.height
                              : state.template.ref.yRel * canvas.height);
      drag = { target, startX: p.x, startY: p.y, origX: xCur, origY: yCur };
      canvas.setPointerCapture(e.pointerId);
    } else if (state.bg.type === "image") {
      drag = { target: "bg", startX: p.x, startY: p.y, origX: state.bg.offsetX, origY: state.bg.offsetY };
      canvas.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e) {
    if (!drag) return;
    const p = canvasCoord(e);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    if (drag.target === "bg") {
      state.bg.offsetX = drag.origX + dx;
      state.bg.offsetY = drag.origY + dy;
    } else {
      state[drag.target].x = drag.origX + dx;
      state[drag.target].y = drag.origY + dy;
    }
    redraw();
  }

  function onPointerUp(e) {
    if (!drag) return;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    drag = null;
  }

  // ── 상태 메시지 ─────────────────────────────────────────────────────────
  let _statusTimer = null;
  function showStatus(msg, autoHide) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle("hidden", !msg);
    if (_statusTimer) clearTimeout(_statusTimer);
    if (autoHide) {
      _statusTimer = setTimeout(() => {
        statusEl.classList.add("hidden");
      }, autoHide);
    }
  }

  // ── 내보내기 ────────────────────────────────────────────────────────────
  async function exportImage(mode) {
    showStatus("이미지 생성 중...");
    try {
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png");
      });
      const fileName = buildFileName();
      const file = new File([blob], fileName, { type: "image/png" });

      if (mode === "share" && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "성경절 카드", text: state.ref.text });
          showStatus("공유 완료", 1500);
          return;
        } catch (err) {
          if (err && err.name === "AbortError") { showStatus("", 0); return; }
          // 공유 실패 시 다운로드로 폴백
        }
      }
      // 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      showStatus("이미지 저장됨", 1500);
    } catch (err) {
      console.error("export error:", err);
      showStatus("저장 실패: 외부 이미지의 CORS 제한일 수 있습니다", 3500);
    }
  }

  function buildFileName() {
    const ref = (state.ref.text || "verse").replace(/[\\/:*?"<>|\s]+/g, "_");
    const ymd = new Date().toISOString().slice(0, 10);
    return `성경절카드_${ref}_${ymd}.png`;
  }

  return { init, open, close };
})();
