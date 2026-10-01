// ============================================================================
// 미니 미디어바 — 성경암송의 녹음·이어듣기를 하단에서 조작한다
// ----------------------------------------------------------------------------
// 음성 패널의 [● 녹음 시작] · [▶ 전체 재생] 을 누르면 패널이 닫히고, 형광펜 팔레트가
// 펼쳐지는 바로 그 자리(하단 메뉴바 위)에 이 바가 뜬다. 카드를 보면서 조작하려는 것이다.
//
//   ● 녹음   ▶ 재생   ⏸ 잠시 멈춤   ■ 정지   🔀 셔플   🔁 반복 1·2·3회   ✕ 나가기
//
// 녹음 중 ◀▶ — 지금 과의 녹음을 저장하고 옆 과로 옮겨 곧바로 새로 녹음한다.
//   언어는 처음 녹음을 시작할 때 고른 것을 끝까지 지킨다(세션 언어).
//   1.5초보다 짧은 녹음은 저장하지 않는다 — ◀▶ 를 연달아 눌러 지나가다가 이미 있는
//   녹음을 1초짜리로 덮어쓰는 사고를 막는다.
// 이어듣기 중 ◀▶ — 이전·다음 곡. 나오는 과가 카드에도 뜬다.
//
// 앱 상태는 js/app.js 가 내놓은 MemoBridge 로만 읽고 움직인다.
// ============================================================================
(function () {
  "use strict";

  const MIN_SAVE_SEC = 1.5;          // 이보다 짧으면 저장하지 않는다 (덮어쓰기 사고 방지)
  const REPEAT_STEPS = [1, 2, 3];    // 🔁 를 누를 때마다 1 → 2 → 3 → 1
  const LANG_LABEL = { ko: "한", en: "EN", ja: "日", zh: "中", in: "IN" };

  const B = () => window.MemoBridge;
  const $ = (id) => document.getElementById(id);
  const recKey = (q, l, lang) => `rec:${q}:${l}:${lang}`;

  const S = {
    mode: "idle",        // idle | rec | play
    lang: null,          // 세션 언어 — 녹음·이어듣기 모두 이것을 따른다
    // 녹음
    recKey: null, recLesson: 0, recLang: null, recT0: 0, pausedMs: 0, pauseAt: 0, recTimer: null,
    busy: false, finishing: null, navigating: false, gen: 0,
    // 이어듣기
    audio: null, queue: [], idx: -1, repeat: 1, played: 0, paused: false, quarter: null,
    shuffle: false
  };

  // ── 바 만들기 (팔레트 바로 뒤에 둔다 — CSS 형제 선택자로 팔레트가 열리면 위로 비킨다) ──
  function ensureBar() {
    let bar = $("mini-media");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "mini-media";
    bar.className = "mini-media hidden";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "녹음·재생 조작");
    bar.innerHTML = `
      <div class="mm-status">
        <button class="mm-lang" id="mm-lang" title="녹음·재생 언어 (멈춰 있을 때 바꿉니다)"></button>
        <span class="mm-text" id="mm-text"></span>
        <span class="mm-time" id="mm-time"></span>
      </div>
      <div class="mm-btns">
        <button id="mm-rec"   class="mm-btn mm-rec"   title="녹음"       aria-label="녹음">●</button>
        <button id="mm-play"  class="mm-btn"          title="재생"       aria-label="재생">▶</button>
        <button id="mm-pause" class="mm-btn"          title="잠시 멈춤"  aria-label="잠시 멈춤">❚❚</button>
        <button id="mm-stop"  class="mm-btn"          title="정지 (녹음은 저장)" aria-label="정지">■</button>
        <button id="mm-shuf"  class="mm-btn mm-tog"   title="셔플"       aria-label="셔플">🔀</button>
        <button id="mm-rep"   class="mm-btn mm-tog"   title="반복 횟수"  aria-label="반복 횟수">🔁<sub id="mm-rep-n">1</sub></button>
        <button id="mm-exit"  class="mm-btn mm-exit"  title="나가기"     aria-label="나가기">✕</button>
      </div>`;
    const pal = $("highlight-palette");
    if (pal) pal.insertAdjacentElement("afterend", bar);
    else document.body.appendChild(bar);

    $("mm-rec").onclick   = () => (S.mode === "rec" && VoiceRecorder.isPaused) ? togglePause() : record({});
    $("mm-play").onclick  = () => (S.mode === "play" && S.paused) ? togglePause() : playCategory({ from: B().state.lesson });
    $("mm-pause").onclick = togglePause;
    $("mm-stop").onclick  = () => stop();
    $("mm-shuf").onclick  = () => setShuffle(!S.shuffle);
    $("mm-rep").onclick   = () => { S.repeat = REPEAT_STEPS[(REPEAT_STEPS.indexOf(S.repeat) + 1) % REPEAT_STEPS.length]; paint(); };
    $("mm-exit").onclick  = exit;
    $("mm-lang").onclick  = cycleLang;
    return bar;
  }

  function show() { ensureBar().classList.remove("hidden"); paint(); }

  // ── 그리기 ────────────────────────────────────────────────────────────
  function lessonLabel(n) {
    const ld = B().lessons()[n - 1];
    return (ld && ld.badgeText) || `제${n}과`;
  }
  function fmt(sec) { return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); }

  function paint() {
    const bar = $("mini-media"); if (!bar) return;
    const recPaused = S.mode === "rec" && VoiceRecorder.isPaused;
    bar.dataset.mode = S.mode;
    bar.classList.toggle("is-paused", recPaused || (S.mode === "play" && S.paused));
    $("mm-lang").textContent = LANG_LABEL[S.lang] || "한";
    $("mm-lang").disabled = S.mode !== "idle";
    $("mm-rep-n").textContent = String(S.repeat);
    $("mm-shuf").classList.toggle("on", S.shuffle);
    $("mm-rep").classList.toggle("on", S.repeat > 1);
    $("mm-rec").classList.toggle("on", S.mode === "rec" && !recPaused);
    $("mm-play").classList.toggle("on", S.mode === "play" && !S.paused);
    $("mm-play").disabled = S.mode === "rec";
    $("mm-pause").disabled = S.mode === "idle" || recPaused || (S.mode === "play" && S.paused);
    $("mm-stop").disabled = S.mode === "idle" || !!S.finishing;

    let text = "", time = "";
    if (S.mode === "rec") {
      text = `${recPaused ? "❚❚ 멈춤" : "● 녹음 중"} · ${lessonLabel(S.recLesson)}  ◀▶ 로 저장하고 옆 과로`;
      time = fmt(Math.floor(recElapsed()));
    } else if (S.mode === "play") {
      const it = S.queue[S.idx];
      if (it) {
        text = `${S.paused ? "❚❚" : "▶"} ${S.idx + 1}/${S.queue.length} · ${lessonLabel(it.lesson)} · ${it.src === "rec" ? "내 녹음" : "기본 음성"}`;
        time = S.repeat > 1 ? `${Math.min(S.played + 1, S.repeat)}/${S.repeat}회` : "";
      }
    } else {
      text = `${lessonLabel(B().state.lesson)} · ● 녹음  ▶ 여기부터 이어듣기`;
    }
    $("mm-text").textContent = text;
    $("mm-time").textContent = time;
    const pt = $("ap-rec-timer-panel"); if (pt && S.mode === "rec") pt.textContent = time;   // 음성 패널을 열어도 같은 시계
  }

  // ── 언어 ──────────────────────────────────────────────────────────────
  function cycleLang() {
    if (S.mode !== "idle") return;
    const ls = B().langs();
    S.lang = ls[(ls.indexOf(S.lang) + 1) % ls.length];
    paint();
  }

  // ── 녹음 ──────────────────────────────────────────────────────────────
  // 녹음 시간은 시계 눈금이 아니라 실제 흐른 시간(멈춘 동안 뺌)으로 잰다
  const recElapsed = () => (performance.now() - S.recT0 - S.pausedMs - (S.pauseAt ? performance.now() - S.pauseAt : 0)) / 1000;

  // opts.lesson 이 오면 그 과로 녹음한다(◀▶ 로 옮길 때 — 애니메이션을 기다리지 않고 열쇠를 정한다)
  async function record(opts) {
    if (S.busy || S.finishing || S.mode === "rec") return;
    if (opts.lang) S.lang = opts.lang;
    if (!S.lang) S.lang = B().state.primaryLang;
    S.gen++;                                  // 쌓고 있던 이어듣기 목록이 있으면 버린다
    stopPlayback(true);
    B().stopOtherAudio();
    show();
    const st = B().state, lesson = opts.lesson || st.lesson;
    const key = recKey(st.quarter, lesson, S.lang);   // 마이크 허락을 기다리기 **전에** 열쇠를 붙잡는다
    S.busy = true;
    try {
      await VoiceRecorder.start();
    } catch (e) {
      alert("마이크 접근 권한이 필요합니다.\n설정에서 마이크를 허용해 주세요.");
      return;
    } finally {
      S.busy = false;
      paint();
    }
    S.mode = "rec";
    S.recLesson = lesson; S.recKey = key; S.recLang = S.lang;
    S.recT0 = performance.now(); S.pausedMs = 0; S.pauseAt = 0;
    clearInterval(S.recTimer);
    S.recTimer = setInterval(paint, 500);
    paint();
  }

  // 녹음을 끝내고 저장한다. 짧으면 버린다. 두 번 불려도 한 번만 돈다. 돌려주는 값: 저장했나
  function finishRecording() {
    if (S.finishing) return S.finishing;
    if (S.mode !== "rec") return Promise.resolve(false);
    S.finishing = (async () => {
      clearInterval(S.recTimer); S.recTimer = null;
      const key = S.recKey, n = S.recLesson, lang = S.recLang, sec = recElapsed();
      let blob = null;
      try { blob = await VoiceRecorder.stop(); }
      catch (e) { B().showToast("녹음을 끝내지 못했습니다 — 다시 시도해 주세요"); }
      S.mode = "idle"; S.recKey = null;
      if (!blob || !key) return false;
      if (sec < MIN_SAVE_SEC) { B().showToast(`${lessonLabel(n)} — 너무 짧아 저장하지 않았습니다`); return false; }
      try {
        await AudioStore.save(key, blob);
      } catch (e) {
        B().showToast(`⚠ ${lessonLabel(n)} 녹음을 저장하지 못했습니다 (저장 공간을 확인해 주세요)`);
        return false;
      }
      B().showToast(`💾 ${lessonLabel(n)} 녹음 저장 (${LANG_LABEL[lang]})`);
      B().refreshAudioBadge();
      return true;
    })().finally(() => { S.finishing = null; paint(); });
    return S.finishing;
  }

  // ── 이어듣기 ──────────────────────────────────────────────────────────
  // 내 녹음(세션 언어) 우선, 없으면 기본 음성. 녹음 열쇠는 과 위치(1부터) 기준
  async function lessonAudio(n) {
    const st = B().state, ld = B().lessons()[n - 1];
    if (!ld) return null;
    const recUrl = await AudioStore.getURL(recKey(st.quarter, n, S.lang || st.primaryLang));
    if (recUrl) return { lesson: n, url: recUrl, src: "rec" };
    const s = ld.audio;
    if (s && s.startsWith("user:")) {
      const u = await AudioStore.getURL(s.slice(5));
      if (u) return { lesson: n, url: u, src: "preset" };
    } else if (s) {
      return { lesson: n, url: s, src: "preset" };
    }
    return null;
  }

  function shuffleArr(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  async function playCategory(opts) {
    if (S.busy) return;
    if (S.mode === "rec") await finishRecording();
    if (opts.lang) S.lang = opts.lang;
    if (!S.lang) S.lang = B().state.primaryLang;
    stopPlayback(true);
    B().stopOtherAudio();
    show();
    const gen = ++S.gen;
    const total = B().lessons().length;
    const from = Math.max(1, Math.min(total, opts.from || 1));
    const items = [];
    S.busy = true;
    try {
      for (let n = 1; n <= total; n++) {
        const a = await lessonAudio(n);
        if (a) items.push(a);
      }
    } catch (e) {
      B().showToast("음성 목록을 읽지 못했습니다");
      return;
    } finally {
      S.busy = false;
      paint();
    }
    if (gen !== S.gen) return;              // 그사이 ■·✕·● 를 눌렀다
    if (!items.length) { B().showToast("재생할 음성이 없습니다 (녹음·기본 음성 모두 없음)"); return; }
    // 셔플이면 전부 섞되 지금 과를 맨 앞에. 아니면 지금 과부터 끝까지 차례로
    let q = S.shuffle ? shuffleArr(items.slice()) : items.filter(it => it.lesson >= from);
    if (!q.length) q = items;
    if (S.shuffle) {
      const i = q.findIndex(it => it.lesson === from);
      if (i > 0) q.unshift(q.splice(i, 1)[0]);
    }
    S.queue = q; S.idx = 0; S.mode = "play"; S.paused = false; S.quarter = B().state.quarter;
    playCurrent();
  }

  function playCurrent() {
    const it = S.queue[S.idx];
    if (!it) { stopPlayback(); B().showToast("▶ 이어듣기 완료"); return; }
    // 카테고리를 바꿨으면 목록이 옛것이다 — 그만둔다
    if (B().state.quarter !== S.quarter) { stopPlayback(); B().showToast("카테고리가 바뀌어 이어듣기를 멈췄습니다"); return; }
    S.played = 0;
    if (B().state.lesson !== it.lesson) B().goToLesson(it.lesson);   // 나오는 과를 카드에
    playOnce(it);
  }

  function playOnce(it) {
    if (S.audio) { S.audio.onended = S.audio.onerror = null; S.audio.pause(); }
    const a = new Audio(it.url);
    S.audio = a;
    a.onended = () => {
      S.played++;
      if (S.played < S.repeat) { playOnce(it); return; }   // 🔁 반복
      S.idx++; playCurrent();
    };
    a.onerror = () => { S.idx++; playCurrent(); };
    a.play().catch(() => {});
    S.paused = false;
    paint();
  }

  // quiet: 바를 그대로 두고 상태만 비운다
  function stopPlayback(quiet) {
    if (S.audio) { S.audio.onended = S.audio.onerror = null; S.audio.pause(); S.audio = null; }
    if (S.mode === "play") S.mode = "idle";
    S.queue = []; S.idx = -1; S.paused = false;
    if (!quiet) paint();
  }

  function setShuffle(on) {
    S.shuffle = !!on;
    // 이어듣는 중이면 남은 곡만 다시 섞는다 (지금 곡은 그대로)
    if (S.mode === "play" && S.idx >= 0) {
      const rest = S.queue.slice(S.idx + 1);
      const ordered = S.shuffle ? shuffleArr(rest) : rest.sort((a, b) => a.lesson - b.lesson);
      S.queue = S.queue.slice(0, S.idx + 1).concat(ordered);
    }
    const pb = $("ap-cat-shuffle"); if (pb) pb.classList.toggle("on", S.shuffle);
    paint();
  }

  // ── 공통 조작 ─────────────────────────────────────────────────────────
  function togglePause() {
    if (S.finishing) return;
    if (S.mode === "rec") {
      if (VoiceRecorder.isPaused) { VoiceRecorder.resume(); S.pausedMs += performance.now() - S.pauseAt; S.pauseAt = 0; }
      else { VoiceRecorder.pause(); S.pauseAt = performance.now(); }
    } else if (S.mode === "play" && S.audio) {
      if (S.paused) { S.audio.play().catch(() => {}); S.paused = false; }
      else { S.audio.pause(); S.paused = true; }
    }
    paint();
  }

  async function stop() {
    S.gen++;                                  // 쌓고 있던 이어듣기 목록을 버린다
    if (S.mode === "rec" || S.finishing) await finishRecording();
    else stopPlayback(true);
    paint();
  }

  async function exit() {
    const bar = $("mini-media"); if (bar) bar.classList.add("hidden");
    await stop();
  }

  // ── ◀▶ 가로채기 — app.js 의 navigateLesson 이 먼저 묻는다. true 면 여기서 처리했다 ──
  function interceptNav(dir) {
    if (S.navigating || S.finishing) return true;          // 옮기는 중에 또 누른 것은 삼킨다
    if (S.mode === "rec") { navWhileRecording(dir); return true; }
    if (S.mode === "play") {
      const j = S.idx + dir;
      if (j < 0 || j >= S.queue.length) { B().showToast(dir > 0 ? "마지막 곡입니다" : "첫 곡입니다"); return true; }
      S.idx = j; playCurrent();
      return true;
    }
    return false;
  }

  async function navWhileRecording(dir) {
    const target = S.recLesson + dir;
    if (target < 1 || target > B().lessons().length) {
      B().showToast(dir > 0 ? "마지막 과입니다 — 녹음은 계속됩니다" : "첫 과입니다 — 녹음은 계속됩니다");
      return;
    }
    S.navigating = true;
    try {
      await finishRecording();              // 이 과에 저장
      B().navigateLesson(dir);              // 옆 과로 (카드 애니메이션)
      await record({ lesson: target });     // 같은 언어로 — 열쇠는 target 으로 바로 정한다
    } finally {
      S.navigating = false;
      paint();
    }
  }

  window.MiniMedia = {
    record, playCategory, stop, stopPlayback, setShuffle, interceptNav, exit,
    get shuffle() { return S.shuffle; },
    get mode() { return S.mode; }
  };
})();
