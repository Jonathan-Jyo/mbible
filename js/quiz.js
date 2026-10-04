// ============================================================================
// 퀴즈 — 지금 카테고리의 기억절로 무작위 문제를 낸다 (하단 바 🔍 다음의 ⚽)
// ----------------------------------------------------------------------------
// 1. 몇 문제 · 난이도를 고르고 [만들기]
// 2. 문제마다 장절과 가려진 본문이 나온다. 말하거나(🎙) 적어서 답하고 [채점]
//    💡 힌트 · ⏭ 패스 · 👁 정답 보기
// 3. 끝에 총점(만점 100)
//
// 난이도 = 기억절 길이 × 암송 단계
//   쉬움   짧은 기억절 쪽에서 · 2단계(부분숨김)처럼 절반쯤만 가린다
//   보통   길이 가리지 않음   · 3단계(한글자만)처럼 단어마다 한 글자만 보인다
//   어려움 긴 기억절 쪽에서   · 4단계(전체숨김)처럼 장절만 보인다
//
// 점수 — 문제마다 배점이 다르다: 기억절이 길수록 크고, 합이 100.
//   받는 점수 = 배점 × 정확도 × (1 − 힌트 수 × 힌트 값)
//   힌트 값은 난이도가 높을수록 작다(어려운 문제에서 힌트를 본 것은 덜 깎는다).
//   정확도 — 띄어쓰기·문장부호를 빼고 글자로 견준다. 95% 이상이면 만점, 50% 미만이면 0.
//   패스·정답 보기는 0점.
//
// 말로 답하기 — 브라우저(크롬·사파리)는 Web Speech API, 안드로이드 앱은
//   @capacitor-community/speech-recognition. 둘 다 없으면 적어서 답한다.
// ============================================================================
(function () {
  "use strict";

  const LEVELS = {
    easy:   { name: "쉬움",   desc: "짧은 기억절 · 절반쯤 가림 (2단계)",      pool: "short", hintCost: 0.40 },
    normal: { name: "보통",   desc: "길이 상관없이 · 한 글자만 보임 (3단계)", pool: "all",   hintCost: 0.30 },
    hard:   { name: "어려움", desc: "긴 기억절 · 장절만 보임 (4단계)",        pool: "long",  hintCost: 0.25 }
  };
  const FULL_MARK_ACC = 0.95;   // 이 이상이면 만점
  const ZERO_ACC = 0.50;        // 이 미만이면 0점

  const B = () => window.MemoBridge;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let Q = null;          // 진행 중인 퀴즈
  let root = null;

  // ── 글자 견주기 ─────────────────────────────────────────────────────────
  const norm = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");

  function lcsLen(a, b) {
    if (!a.length || !b.length) return 0;
    let prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array(b.length + 1).fill(0);
      for (let j = 1; j <= b.length; j++) {
        cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      }
      prev = cur;
    }
    return prev[b.length];
  }
  // 0~1 — 두 글자열이 얼마나 같은가 (2·공통 / 길이 합)
  function similarity(answer, given) {
    const a = [...norm(answer)], g = [...norm(given)];
    if (!a.length) return 0;
    return (2 * lcsLen(a, g)) / (a.length + g.length);
  }
  // 정답 단어마다 맞췄나 — 단어 단위 공통 부분열로 표시한다
  function wordMarks(words, given) {
    const aw = words.map(norm), gw = tokenize(String(given || ""), B().state.primaryLang).map(norm).filter(Boolean);
    const n = aw.length, m = gw.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = aw[i] && aw[i] === gw[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const hit = new Array(n).fill(false);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (aw[i] && aw[i] === gw[j]) { hit[i] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return hit;
  }

  // ── 문제 만들기 ─────────────────────────────────────────────────────────
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function candidates() {
    const lang = B().state.primaryLang;
    return B().lessons().map((ld, i) => {
      const text = (ld.verse && (ld.verse[lang] || ld.verse.ko)) || "";
      const ref = (ld.reference && (ld.reference[lang] || ld.reference.ko)) || "";
      const title = (ld.title && (ld.title[lang] || ld.title.ko)) || "";
      return { lesson: i + 1, text, ref, title, len: [...norm(text)].length };
    }).filter(c => c.len > 0);
  }

  function build(count, levelKey) {
    const lv = LEVELS[levelKey], lang = B().state.primaryLang;
    const all = candidates().sort((a, b) => a.len - b.len);
    // 짧은 쪽 · 긴 쪽에서 고른다 — 문제 수보다 적으면 가운데까지 넓힌다
    const take = Math.max(count, Math.ceil(all.length * 0.6));
    const pool = lv.pool === "short" ? all.slice(0, take) : lv.pool === "long" ? all.slice(-take) : all;
    const picked = shuffle(pool.slice()).slice(0, count);
    const sumLen = picked.reduce((s, c) => s + c.len, 0) || 1;
    const items = picked.map(c => {
      const words = tokenize(c.text, lang);
      let st;
      if (levelKey === "easy") {
        const hide = computePartialHideIndices(words, lang);
        st = words.map((_, i) => hide.has(i) ? "hidden" : "shown");
      } else if (levelKey === "normal") st = words.map(() => "letter");
      else st = words.map(() => "hidden");
      return { ...c, words, st, points: (c.len / sumLen) * 100, hints: 0, answer: "", acc: null, got: 0, status: "open" };
    });
    // 반올림으로 합이 99.9 가 되지 않게 마지막 문제에서 맞춘다
    const rounded = items.map(it => Math.round(it.points * 10) / 10);
    const diff = Math.round((100 - rounded.reduce((s, x) => s + x, 0)) * 10) / 10;
    rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1] + diff) * 10) / 10;
    items.forEach((it, i) => { it.points = rounded[i]; });
    return { level: levelKey, items, idx: 0 };
  }

  // 힌트 — 가려진 것을 한 단계씩 드러낸다
  function applyHint(it) {
    const hidden = it.st.map((s, i) => s === "hidden" ? i : -1).filter(i => i >= 0);
    if (Q.level === "hard" && hidden.length === it.st.length) {
      it.st = it.st.map(() => "letter");                    // 어려움의 첫 힌트: 한 글자씩
    } else {
      const from = hidden.length ? "hidden" : "letter";
      const idx = shuffle(it.st.map((s, i) => s === from ? i : -1).filter(i => i >= 0));
      const n = Math.max(1, Math.ceil(idx.length / 3));
      idx.slice(0, n).forEach(i => { it.st[i] = "shown"; });
    }
    it.hints++;
  }
  const canHint = (it) => it.st.some(s => s !== "shown");

  // ── 화면 ────────────────────────────────────────────────────────────────
  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "quiz-overlay";
    root.className = "quiz-overlay hidden";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "quiz-title");
    root.innerHTML = `<div class="quiz-sheet"><div class="quiz-head">
        <span class="quiz-title" id="quiz-title">⚽ 퀴즈</span>
        <button class="overlay-close quiz-close" aria-label="닫기">✕</button></div>
      <div class="quiz-body" id="quiz-body"></div></div>`;
    document.body.appendChild(root);
    root.querySelector(".quiz-close").onclick = askClose;
    root.addEventListener("click", (e) => { if (e.target === root) askClose(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !root.classList.contains("hidden")) askClose(); });
    return root;
  }
  const body = () => document.getElementById("quiz-body");

  function open() {
    if (window.MiniMedia && MiniMedia.mode !== "idle") MiniMedia.stop();
    ensureRoot().classList.remove("hidden");
    drawSetup();
  }
  // 풀던 중이면 묻고 닫는다 — 바깥을 잘못 건드려 점수를 날리지 않게
  function askClose() {
    const midway = Q && Q.items.some(it => it.status !== "open") && Q.items.some(it => it.status === "open");
    if (midway && !confirm("퀴즈를 그만둘까요? 지금까지의 점수는 남지 않습니다.")) return;
    close();
  }
  function close() {
    stopListening();
    if (root) root.classList.add("hidden");
    Q = null;
  }

  function catName() {
    const sel = document.getElementById("quarter-select");
    return sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent.trim() : "이 카테고리";
  }

  function drawSetup() {
    const total = candidates().length;
    if (!total) { body().innerHTML = `<p class="quiz-empty">이 카테고리에는 기억절이 없습니다.</p>`; return; }
    const counts = [...new Set([5, 10, total].filter(n => n <= total))].sort((a, b) => a - b);
    const prefCount = Math.min(total, +(localStorage.getItem("quiz-count") || 5));
    const prefLevel = localStorage.getItem("quiz-level") || "normal";
    body().innerHTML = `
      <p class="quiz-lead"><b>${esc(catName())}</b>의 기억절 ${total}개에서 무작위로 냅니다.</p>
      <div class="quiz-label">몇 문제</div>
      <div class="quiz-chips" id="qz-count">${counts.map(n =>
        `<button data-n="${n}" class="${n === prefCount || (!counts.includes(prefCount) && n === counts[0]) ? "on" : ""}">${n === total ? `전부 ${n}` : n}</button>`).join("")}</div>
      <div class="quiz-label">난이도</div>
      <div class="quiz-levels" id="qz-level">${Object.entries(LEVELS).map(([k, v]) =>
        `<button data-lv="${k}" class="${k === prefLevel ? "on" : ""}"><b>${v.name}</b><span>${v.desc}</span></button>`).join("")}</div>
      <p class="quiz-note">기억절이 길수록 배점이 크고, 모두 맞히면 100점입니다. 힌트를 보면 그 문제에서 깎이는데, 어려울수록 덜 깎입니다.</p>
      <button class="quiz-go" id="qz-make">만들기</button>`;
    const pick = (box, attr) => box.addEventListener("click", (e) => {
      const b = e.target.closest(`[${attr}]`); if (!b) return;
      box.querySelectorAll(`[${attr}]`).forEach(x => x.classList.toggle("on", x === b));
    });
    pick(document.getElementById("qz-count"), "data-n");
    pick(document.getElementById("qz-level"), "data-lv");
    document.getElementById("qz-make").onclick = () => {
      const n = +(body().querySelector("#qz-count .on")?.dataset.n || counts[0]);
      const lv = body().querySelector("#qz-level .on")?.dataset.lv || "normal";
      try { localStorage.setItem("quiz-count", String(n)); localStorage.setItem("quiz-level", lv); } catch (e) {}
      Q = build(n, lv);
      drawQuestion();
    };
  }

  function maskedHTML(it) {
    const lang = B().state.primaryLang;
    return it.words.map((w, i) => {
      const s = it.st[i];
      if (s === "shown") return `<span class="qw">${esc(w)}</span>`;
      if (s === "letter") return `<span class="qw qw-letter">${esc(getHintText(w, lang))}</span>`;
      return `<span class="qw qw-hidden" style="width:${calcWordWidth(w, lang)}"></span>`;
    }).join(" ");
  }

  function drawQuestion() {
    const it = Q.items[Q.idx], lv = LEVELS[Q.level], n = Q.items.length;
    const done = it.status !== "open";
    body().innerHTML = `
      <div class="quiz-progress"><span>${Q.idx + 1} / ${n}</span><span>${lv.name} · 배점 ${it.points}점</span></div>
      <div class="quiz-meter"><i style="width:${(Q.idx / n) * 100}%"></i></div>
      <div class="quiz-ref">${esc(it.ref)} <small>${esc(it.title)}</small></div>
      <div class="quiz-text" id="qz-text">${done ? resultHTML(it) : maskedHTML(it)}</div>
      ${done ? "" : `
      <div class="quiz-answer">
        <textarea id="qz-ans" rows="3" placeholder="기억절을 말하거나 적어 보세요" spellcheck="false">${esc(it.answer)}</textarea>
        <button class="quiz-mic" id="qz-mic" aria-label="말해서 답하기" title="말해서 답하기" hidden>🎙</button>
      </div>
      <div class="quiz-mic-state" id="qz-mic-state" aria-live="polite"></div>
      <div class="quiz-acts">
        <button id="qz-hint" ${canHint(it) ? "" : "disabled"}>💡 힌트${it.hints ? ` ${it.hints}` : ""}</button>
        <button id="qz-pass">⏭ 패스</button>
        <button id="qz-show">👁 정답 보기</button>
        <button id="qz-grade" class="quiz-go">채점</button>
      </div>`}
      ${done ? `<button class="quiz-go" id="qz-next">${Q.idx + 1 < n ? "다음 문제" : "총점 보기"}</button>` : ""}`;
    if (done) { document.getElementById("qz-next").onclick = next; return; }
    const ans = document.getElementById("qz-ans");
    ans.oninput = () => { it.answer = ans.value; };
    // 받아 적는 중에 그리면 글칸이 새로 바뀌어 그 뒤의 말이 사라진다 — 먼저 듣기를 끝낸다
    document.getElementById("qz-hint").onclick = () => { stopListening(); applyHint(it); it.answer = ans.value; drawQuestion(); };
    document.getElementById("qz-pass").onclick = () => finish(it, "pass");
    document.getElementById("qz-show").onclick = () => finish(it, "shown");
    document.getElementById("qz-grade").onclick = () => {
      if (!norm(ans.value)) { ans.focus(); return; }
      it.answer = ans.value; finish(it, "graded");
    };
    setupMic(ans);
  }

  function finish(it, how) {
    stopListening();
    it.status = how;
    if (how === "graded") {
      it.acc = similarity(it.text, it.answer);
      const factor = it.acc >= FULL_MARK_ACC ? 1 : it.acc < ZERO_ACC ? 0 : it.acc;
      const hintKeep = Math.max(0, 1 - it.hints * LEVELS[Q.level].hintCost);
      it.got = Math.round(it.points * factor * hintKeep * 10) / 10;
    } else {
      it.acc = null; it.got = 0;
    }
    drawQuestion();
  }

  function resultHTML(it) {
    const marks = it.status === "graded" ? wordMarks(it.words, it.answer) : null;
    const text = it.words.map((w, i) => marks
      ? `<span class="qw ${marks[i] ? "qw-ok" : "qw-miss"}">${esc(w)}</span>`
      : `<span class="qw">${esc(w)}</span>`).join(" ");
    let verdict;
    if (it.status === "pass") verdict = `<b>패스</b> · 0점`;
    else if (it.status === "shown") verdict = `<b>정답 보기</b> · 0점`;
    else verdict = `정확도 <b>${Math.round(it.acc * 100)}%</b>${it.hints ? ` · 힌트 ${it.hints}번` : ""} · <b class="quiz-got">${it.got}</b> / ${it.points}점`;
    return `<div class="quiz-verdict">${verdict}</div><div>${text}</div>`
      + (it.status === "graded" ? `<div class="quiz-mine">내 답: ${esc(it.answer)}</div>` : "");
  }

  function next() {
    if (Q.idx + 1 < Q.items.length) { Q.idx++; drawQuestion(); }
    else drawTotal();
  }

  function drawTotal() {
    const total = Math.round(Q.items.reduce((s, it) => s + it.got, 0) * 10) / 10;
    const word = total >= 95 ? "훌륭합니다!" : total >= 80 ? "잘하셨습니다" : total >= 60 ? "조금만 더" : "다시 한 번 해 보세요";
    body().innerHTML = `
      <div class="quiz-total"><div class="quiz-score">${total}<small>점</small></div><div>${word}</div>
        <div class="quiz-sub">${LEVELS[Q.level].name} · ${Q.items.length}문제</div></div>
      <ol class="quiz-list">${Q.items.map(it =>
        `<li><span>${esc(it.ref)}</span><span>${it.status === "graded" ? `${Math.round(it.acc * 100)}%${it.hints ? ` · 💡${it.hints}` : ""}` : it.status === "pass" ? "패스" : "정답 보기"}</span><b>${it.got}/${it.points}</b></li>`).join("")}</ol>
      <div class="quiz-acts"><button id="qz-again">같은 조건으로 다시</button><button id="qz-setup">조건 바꾸기</button><button class="quiz-go" id="qz-close">닫기</button></div>`;
    const lv = Q.level, n = Q.items.length;
    document.getElementById("qz-again").onclick = () => { Q = build(n, lv); drawQuestion(); };
    document.getElementById("qz-setup").onclick = drawSetup;
    document.getElementById("qz-close").onclick = close;
  }

  // ── 말로 답하기 ─────────────────────────────────────────────────────────
  // 받아쓰기는 js/dictation.js 한 곳에서 한다(매일기도와 같은 것)
  async function setupMic(ans) {
    const btn = document.getElementById("qz-mic");
    if (!window.Dictation || !(await Dictation.available()) || !document.body.contains(btn)) return;   // 못 하면 적어서만
    btn.hidden = false;
    btn.onclick = () => {
      if (Dictation.listening) { stopListening(); return; }
      Dictation.start({ field: ans, btn, lang: B().state.primaryLang,
        onState: (on, msg) => { const st = document.getElementById("qz-mic-state"); if (st) st.textContent = msg; } });
    };
  }
  function stopListening() { if (window.Dictation && Dictation.listening) Dictation.stop(); }

  // ── 하단 바 단추 ────────────────────────────────────────────────────────
  function bind() {
    const b = document.getElementById("quiz-btn");
    if (b) b.addEventListener("click", open);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.MemoQuiz = { open, close, _similarity: similarity, _build: build };
})();
