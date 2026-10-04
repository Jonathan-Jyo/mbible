// ============================================================================
// 말로 받아쓰기 — 글칸 옆 🎙 를 누르고 말하면 그 칸에 글로 들어간다
// ----------------------------------------------------------------------------
// 쓰는 곳: 매일기도(기도제목 제목·내용, 감사노트, 달라진 기도), 성경암송 퀴즈.
//   브라우저(크롬·사파리)  Web Speech API
//   안드로이드 앱          @capacitor-community/speech-recognition (기기 음성 인식 — 대개 인터넷 필요)
//   둘 다 없으면 🎙 를 보이지 않는다 — 손으로 적으면 된다.
//
//   Dictation.attach(field, { lang, inline })  글칸 옆에 🎙 를 붙인다
//   Dictation.start({ lang, field, onState })   직접 시작(퀴즈처럼 단추를 따로 둔 곳)
//   Dictation.stop()
//
// 이미 적힌 글은 지우지 않고 **뒤에 이어** 적는다. 한 번에 하나의 칸만 듣는다.
// ============================================================================
(function () {
  "use strict";

  const SPEECH_LANG = { ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "zh-CN", in: "id-ID" };
  const LISTEN_MSG = "듣는 중… 말을 멈추면 몇 초 뒤 저절로 마칩니다 · 🎙 를 누르면 바로 마침";

  let rec = null, listening = false, starting = false, nativeSubs = [], cur = null;   // cur = { field, onState, btn }
  let _avail = null;

  function nativePlugin() {
    const C = window.Capacitor;
    return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.SpeechRecognition) || null;
  }
  function webCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

  // 전체 설정 › 앱 안내 › 「말로 입력 쓰기」 — 끄면 🎙 가 어디에도 나타나지 않는다
  const OFF_KEY = "bible-dict-off";
  function isOff() { try { return localStorage.getItem(OFF_KEY) === "1"; } catch (e) { return false; } }
  function setOn(on) { try { localStorage.setItem(OFF_KEY, on ? "0" : "1"); } catch (e) {} if (!on && listening) stop(); }

  // 이 기기에서 받아쓰기가 되나 — 기기는 한 번만 묻고, 끔 설정은 매번 본다
  function available() {
    if (isOff()) return Promise.resolve(false);
    if (_avail) return _avail;
    const native = nativePlugin();
    _avail = native
      ? native.available().then(r => !!(r && r.available)).catch(() => false)
      : Promise.resolve(!!webCtor());
    return _avail;
  }

  function setState(on, msg) {
    listening = on;
    if (!cur) return;
    if (cur.btn) { cur.btn.classList.toggle("on", on); cur.btn.setAttribute("aria-pressed", on ? "true" : "false"); }
    if (cur.onState) cur.onState(on, msg || "");
  }

  function dropNativeSubs(delayMs) {
    const subs = nativeSubs; nativeSubs = [];
    const go = () => subs.forEach(h => { try { h.remove(); } catch (e) {} });
    if (delayMs) setTimeout(go, delayMs); else go();
  }

  // ── 말이 멈출 때까지 기다린다 ────────────────────────────────────────
  // 음성 인식은 잠깐만 쉬어도 스스로 끝난다(안드로이드는 한 마디 뒤에 끝나기도 했다 — 10/5 보고).
  // 그래서 **스스로 끝나면 조용히 다시 듣고**, 이어서 적는다. 받아쓰기를 마치는 것은 둘뿐이다 —
  //   · 🎙 를 다시 누를 때
  //   · 정말로 말이 멈췄을 때: 말한 뒤 IDLE_MS, 아직 아무 말도 없으면 FIRST_MS 동안 새 말이 없으면
  // 기억절을 떠올리며 쉬는 틈을 넉넉히 둔다.
  const IDLE_MS = 6000, FIRST_MS = 12000, MAX_MS = 5 * 60 * 1000;
  let sess = null;   // { field, lang, base, heard, startedAt, idleTimer, restarting }

  function armIdle() {
    if (!sess) return;
    clearTimeout(sess.idleTimer);
    sess.idleTimer = setTimeout(() => {
      if (!sess) return;
      finish(sess.heard ? "말이 멈춰 받아쓰기를 마쳤습니다" : "아무 말도 들리지 않아 마쳤습니다");
    }, sess.heard ? IDLE_MS : FIRST_MS);
  }

  // 이번 듣기에서 받은 글 t 를 칸에 쓴다 — 다시 들을 때마다 그때까지의 글이 바탕(base)이 된다
  function put(t) {
    const f = sess && sess.field;
    if (!f || !document.body.contains(f)) return;
    if (f.offsetParent === null && getComputedStyle(f).position !== "fixed") { finish(""); return; }   // 창을 닫아 칸이 숨었다
    f.value = sess.base + t;
    f.dispatchEvent(new Event("input", { bubbles: true }));
    if (t.trim()) sess.heard = true;
    armIdle();
  }
  function rebase() {
    const v = sess.field.value;
    sess.base = v ? v.replace(/\s+$/, "") + " " : "";
  }

  async function listenOnce() {
    if (!sess) return;
    rebase();
    const native = nativePlugin();
    if (native) {
      // 되도록 기기 안에서 — 안드로이드 12+ 는 기기 안 인식기, 그 아래는 오프라인 우선(플러그인 패치: patches/)
      try { await native.start({ language: sess.lang, partialResults: true, popup: false, maxResults: 1, preferOffline: sess.preferOffline }); }
      catch (e) { relisten(); }
      return;
    }
    const Ctor = webCtor(); if (!Ctor) return;
    rec = new Ctor();
    rec.lang = sess.lang; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      put(t);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") finish("마이크 권한이 필요합니다");
      else if (e.error === "network") finish("말 인식에 인터넷이 필요합니다");
      // no-speech · aborted 등은 끝(onend)에서 다시 듣는다
    };
    rec.onend = () => { rec = null; relisten(); };
    try { rec.start(); } catch (e) { relisten(); }
  }
  // 안드로이드 SpeechRecognizer 오류 번호
  //   1 네트워크 시간 초과 · 2 네트워크 · 4 서버 · 9 권한 · 12 언어 미지원 · 13 언어 팩 없음
  //   5·6·7·8·11 은 「말이 없었다·못 알아들었다·바쁘다」 — 다시 듣는다
  function onNativeError(code) {
    if (!sess) return;
    if (code === 9) { finish("마이크 권한이 필요합니다"); return; }
    const offlineMissing = code === 12 || code === 13;
    const netFail = code === 1 || code === 2 || code === 4;
    if (sess.preferOffline && (offlineMissing || netFail)) {
      // 기기 안 한국어 음성 팩이 없다 — 이번에는 온라인으로 듣는다(되도록 기기 안, 안 되면 온라인)
      sess.preferOffline = false; sess.fellBack = true;
      sess.where = "온라인 — 이 기기에 한국어 오프라인 음성 팩이 없음";
      setState(true, LISTEN_MSG + " · " + sess.where);
      relisten(); return;
    }
    if (netFail) { finish("말 인식에 인터넷이 필요합니다 (기기 안 한국어 음성 팩을 받으면 인터넷 없이도 됩니다)"); return; }
    relisten();
  }

  // 인식기가 스스로 끝났다 — 아직 마칠 때가 아니면 잠깐 쉬고 다시 듣는다
  function relisten() {
    if (!sess || sess.restarting) return;
    if (Date.now() - sess.startedAt > MAX_MS) { finish("오래 들어서 마쳤습니다"); return; }
    sess.restarting = true;
    setTimeout(() => { if (!sess) return; sess.restarting = false; listenOnce(); }, 250);
  }

  async function start(opts) {
    if (starting || isOff()) return;
    if (listening) stop();                               // 다른 칸이 듣고 있었으면 끝낸다
    starting = true;
    cur = { field: opts.field, onState: opts.onState, btn: opts.btn };
    const lang = SPEECH_LANG[opts.lang] || opts.lang || "ko-KR";
    const native = nativePlugin();
    try {
      if (native) {
        const perm = await native.requestPermissions();
        if (perm && perm.speechRecognition && perm.speechRecognition !== "granted") { setState(false, "마이크 권한이 필요합니다"); return; }
        dropNativeSubs(0);
        nativeSubs.push(await native.addListener("partialResults", (d) => { if (d && d.matches && d.matches[0]) put(d.matches[0]); }));
        // 스스로 멈추면(말이 잠깐 끊겼거나 오류) 마치지 않고 다시 듣는다
        nativeSubs.push(await native.addListener("listeningState", (d) => { if (d && d.status === "stopped" && sess) relisten(); }));
        // 어느 인식기로 듣나 — 「기기 안에서」인지 「온라인」인지 칸 아래에 밝힌다
        nativeSubs.push(await native.addListener("recognizerMode", (d) => {
          if (!sess) return;
          sess.where = d && d.onDevice ? "기기 안에서"
            : sess.preferOffline ? "기기 안 우선"
            : sess.fellBack ? "온라인 — 이 기기에 한국어 오프라인 음성 팩이 없음"
            : "온라인(기기 음성 인식)";
          setState(true, LISTEN_MSG + " · " + sess.where);
        }));
        nativeSubs.push(await native.addListener("error", (d) => onNativeError(d && d.code)));
      } else if (!webCtor()) return;
      sess = { field: opts.field, lang, base: "", heard: false, startedAt: Date.now(), idleTimer: null, restarting: false,
               preferOffline: true, where: "" };
      setState(true, LISTEN_MSG);
      armIdle();
      await listenOnce();
    } catch (e) {
      finish("말 인식을 시작하지 못했습니다 — 적어서 넣어 주세요");
    } finally {
      starting = false;
    }
  }

  // 받아쓰기를 마친다. msg 는 칸 아래에 잠깐 남길 말
  function finish(msg) {
    const s = sess; sess = null;
    if (s) clearTimeout(s.idleTimer);
    const native = nativePlugin();
    if (native) {
      native.stop().catch(() => {});                   // 이 플러그인의 stop 은 풀리지 않는다 — 기다리지 않는다
      dropNativeSubs(600);                               // 멈춘 뒤에 오는 마지막 말까지 받는다
    } else dropNativeSubs(0);
    if (rec) { const r = rec; rec = null; r.onend = null; try { r.stop(); } catch (e) {} }
    setState(false, msg || "");
    if (msg && cur && cur.onState) { const c = cur; setTimeout(() => { if (!listening && c === cur && c.onState) c.onState(false, ""); }, 3500); }
  }
  function stop() { finish(""); }

  // 글칸 옆에 🎙 — inline 이면 바로 뒤에 단추, 아니면 칸 안쪽 오른쪽 위에 겹쳐 둔다
  async function attach(field, opts) {
    opts = opts || {};
    if (!field || field.dataset.dictation) return;
    if (!(await available())) return;
    field.dataset.dictation = "1";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dict-btn" + (opts.inline ? " dict-inline" : "");
    btn.textContent = "🎙";
    btn.title = "말로 입력";
    btn.setAttribute("aria-label", "말로 입력");
    btn.setAttribute("aria-pressed", "false");
    const note = document.createElement("div");
    note.className = "dict-note"; note.setAttribute("aria-live", "polite");
    if (opts.inline) {
      field.insertAdjacentElement("afterend", btn);
      field.parentElement.insertAdjacentElement("afterend", note);   // 그 줄 바로 아래
    } else {
      const wrap = document.createElement("div");
      wrap.className = "dict-wrap";
      field.parentNode.insertBefore(wrap, field);
      wrap.appendChild(field); wrap.appendChild(btn);
      wrap.insertAdjacentElement("afterend", note);
    }
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (listening && cur && cur.field === field) { stop(); return; }
      start({ field, btn, lang: opts.lang || "ko", onState: (on, msg) => { note.textContent = msg; } });
    });
  }

  // 화면을 떠나거나 창을 닫으면 듣기를 끝낸다
  document.addEventListener("visibilitychange", () => { if (document.hidden && listening) stop(); });

  // 단추 모양 — 앱마다 색 토큰 이름이 달라 대체값을 함께 둔다
  const css = document.createElement("style");
  css.textContent = `
    .dict-wrap { position: relative; }
    .dict-wrap > textarea, .dict-wrap > input { padding-right: 46px !important; }
    button.dict-btn.dict-btn { width: 34px; padding: 0; color: inherit; height: 34px; border-radius: 50%; flex: 0 0 auto; cursor: pointer; font-size: 15px; line-height: 1;
      border: 1px solid rgba(233,69,96,0.45); background: rgba(233,69,96,0.08); }
    .dict-wrap > .dict-btn { position: absolute; right: 7px; top: 7px; }
    button.dict-btn.dict-btn.on { background: #e94560; border-color: #e94560; animation: dictPulse 1.4s ease-in-out infinite; }
    button.dict-btn:focus-visible { outline: 2px solid var(--gold, #c9a84c); outline-offset: 2px; }
    .dict-note { min-height: 0; font-size: 12px; color: #e94560; margin: 3px 2px 0; }
    .dict-note:empty { display: none; }
    @keyframes dictPulse { 50% { box-shadow: 0 0 0 4px rgba(233,69,96,0.25); } }
    @media (prefers-reduced-motion: reduce) { .dict-btn.on { animation: none; } }`;
  document.head.appendChild(css);

  window.Dictation = { available, attach, start, stop, setOn, get off() { return isOff(); }, get listening() { return listening; } };
})();
