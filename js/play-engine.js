// ============================================================================
// PlayEngine — 찬양 재생을 한 곳에서 맡는다 (화면을 옮겨도 끊기지 않게)
// ----------------------------------------------------------------------------
// 이 앱은 화면마다 페이지를 새로 연다. 그래서 각 화면이 자기 <audio> 로 소리를 내면
// 화면을 옮기는 순간 소리가 함께 사라졌다(PlayRelay 가 다음 화면에서 이어 틀어도 틈이 났다).
//
// 안드로이드 앱(APK): 소리는 화면 밖의 보이지 않는 작은 웹 화면(player.html — 네이티브
//   PlayerHost 가 띄운다) 하나가 낸다. 그 화면은 페이지를 옮겨도 다시 열리지 않는다.
//   각 화면은 리모컨이다 — 명령을 보내고(BgPlay.engine), 상태를 받는다("engine" 알림).
//   알림 줄·잠금화면·이어폰 조절(js/bg-play.js)도 그 화면에 붙어 있다.
// 브라우저: 그런 바깥 화면을 만들 수 없어 이 화면 안에서 같은 엔진을 돌리고,
//   화면을 옮길 때는 예전처럼 PlayRelay 로 넘겨 이어 튼다.
//
// 화면이 쓰는 것 —
//   PlayEngine.cmd("playList", { list, start, mode, source, shuffle })
//   PlayEngine.cmd("toggle" | "play" | "pause" | "next" | "prev" | "stop")
//   PlayEngine.cmd("seek", { sec }) · cmd("setMode", { mode }) · cmd("setSleep", { min })
//   PlayEngine.state      마지막으로 받은 상태 { ids, idx, id, title, paused, pos, dur, mode, source, sleepEndAt }
//                         (첫 상태가 화면 스크립트보다 먼저 올 수 있다 — 화면은 init 에서 이것으로 한 번 그린다)
//   PlayEngine.subscribe(fn)   상태가 올 때마다 fn(state) — state.ev 에 무슨 일인지
//                              (play · pause · time · track · end · stop · mode · nofiles · blocked · sleep · state)
//   PlayEngine.adoptRelay()    브라우저에서만 — 앞 화면이 넘겨준 재생을 이어받는다
// ============================================================================
const PlayEngine = (() => {
  const MODES = ["order", "repeatAll", "repeatOne", "shuffle"];
  const SLEEP_FADE_SEC = 12;       // 수면 타이머가 끝나기 전 이만큼 서서히 볼륨을 낮춘다
  const TIME_EVERY_MS = 450;       // 재생 위치를 알리는 간격(진행 막대가 매끄러울 만큼만)

  const titleOf = (id) => {
    const it = id && PraiseStore.items().find(x => x.id === id);
    return (it && it.title) || "찬양";
  };
  const TITLE_CACHE_MAX = 64;
  const shuffled = (list) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  // ── 엔진 본체 — 소리를 내는 쪽(player.html, 또는 브라우저에서는 이 화면) ──────
  //  emit(state): 상태를 알리는 길 · nativeBg: 알림 줄·잠금화면 조절(안드로이드만)
  function createCore(emit, nativeBg) {
    const audio = new Audio();
    audio.preload = "auto";
    let ids = [], idx = -1, mode = "repeatAll", source = "", failStreak = 0;
    let sleepEndAt = 0, sleepTick = null;
    // 곡 이름은 곡 목록 전체(가사까지)를 읽어야 나온다 — 곡마다 한 번만 찾는다
    const titles = new Map();
    const titleCached = (id) => {
      if (!titles.has(id)) { if (titles.size >= TITLE_CACHE_MAX) titles.clear(); titles.set(id, titleOf(id)); }
      return titles.get(id);
    };

    // 위치("time")는 0.45초마다 오므로 바뀌는 것만 싣는다 — 받는 쪽이 앞 상태에 덧붙인다
    const snapshot = (ev) => {
      const time = {
        ev, paused: audio.paused, ended: audio.ended,
        pos: audio.currentTime || 0,
        dur: isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0
      };
      if (ev === "time") return time;
      return Object.assign(time, {
        ids, idx, mode, source, sleepEndAt,
        id: idx >= 0 ? ids[idx] : null,
        title: idx >= 0 ? titleCached(ids[idx]) : ""
      });
    };
    const send = (ev) => emit(snapshot(ev));
    const revoke = () => { if (audio.src && audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src); };

    async function loadCurrent(autoplay, startPos) {
      const id = ids[idx];
      let url = null;
      try { url = await PraiseAudio.getURL(id); }
      catch (e) { console.warn("[PlayEngine] 음원을 꺼내지 못했습니다", e); }
      if (id !== ids[idx]) { if (url) URL.revokeObjectURL(url); return; }   // 그사이 다른 곡으로 넘어갔다
      if (!url) { advanceOnFailure(); return; }
      revoke();
      audio.src = url;
      if (startPos) audio.addEventListener("loadedmetadata", () => { audio.currentTime = startPos; }, { once: true });
      if (autoplay) {
        try { await audio.play(); failStreak = 0; }
        catch (e) { send("blocked"); return; }   // 기기가 막았다 — ▶ 를 누르면 이어진다
        try { PraiseStore.logListen(id); } catch (e) { console.warn("[PlayEngine] 들은 기록을 남기지 못했습니다", e); }
      }
      send("track");
    }
    // 깨진 음원 하나에 멈춰 서지 않게 다음 곡으로 — 목록이 통째로 깨졌으면 한 바퀴에서 멈춘다
    function advanceOnFailure() {
      if (++failStreak >= ids.length) { failStreak = 0; audio.pause(); send("nofiles"); return; }
      step(1, true);
    }
    // d: +1 다음 / -1 이전 · auto: 곡이 저절로 끝나서 넘어가는 경우
    function step(d, auto) {
      if (!ids.length) return;
      if (auto && mode === "repeatOne") { audio.currentTime = 0; audio.play().catch(() => {}); return; }
      const last = idx + d >= ids.length, first = idx + d < 0;
      if (last || first) {
        // 순서대로: 저절로 끝났을 때만 멈춘다. 전체반복·셔플·한곡반복은 계속 돈다
        if (auto && mode === "order") { audio.pause(); send("end"); return; }
        if (mode === "shuffle" && last) ids = shuffled(ids);   // 한 바퀴 돌면 새로 섞는다
      }
      idx = (idx + d + ids.length) % ids.length;
      loadCurrent(true);
    }

    function sleepOff() {
      if (sleepTick) { clearInterval(sleepTick); sleepTick = null; }
      sleepEndAt = 0;
      audio.volume = 1;
    }
    function sleepTickFn() {
      const left = sleepEndAt - Date.now();
      if (left <= 0) { audio.pause(); sleepOff(); send("sleep"); return; }
      if (left <= SLEEP_FADE_SEC * 1000) audio.volume = Math.max(0, left / (SLEEP_FADE_SEC * 1000));
    }

    const commands = {
      playList({ list, start, mode: m, source: s, shuffle, pos, paused } = {}) {
        if (!Array.isArray(list) || !list.length) return;
        source = s || "";
        if (MODES.includes(m)) mode = m;
        if (shuffle) mode = "shuffle";
        ids = (mode === "shuffle" && !start) ? shuffled(list) : list.slice();
        idx = Math.max(0, ids.indexOf(start || ids[0]));
        failStreak = 0;
        return loadCurrent(!paused, pos);
      },
      play() {
        if (!ids.length) return;
        if (!audio.src) return loadCurrent(true);
        audio.play().catch(() => send("blocked"));
      },
      pause() { audio.pause(); },
      toggle() { if (audio.paused) commands.play(); else audio.pause(); },
      next() { step(1, false); },
      prev() { step(-1, false); },
      seek({ sec } = {}) {
        if (!isFinite(audio.duration) || !isFinite(sec)) return;
        audio.currentTime = Math.min(Math.max(0, sec), audio.duration);
      },
      setMode({ mode: m } = {}) { if (MODES.includes(m)) { mode = m; send("mode"); } },
      setSleep({ min } = {}) {
        sleepOff();
        if (min > 0) { sleepEndAt = Date.now() + min * 60000; sleepTick = setInterval(sleepTickFn, 1000); }
        send("mode");
      },
      stop() {
        audio.pause();
        revoke();
        audio.removeAttribute("src");
        ids = []; idx = -1; source = "";
        sleepOff();
        send("stop");
      },
      hello() { send("state"); }
    };

    audio.addEventListener("ended", () => step(1, true));
    audio.addEventListener("play", () => send("play"));
    audio.addEventListener("pause", () => send("pause"));
    // 파일이 깨졌거나 디코딩에 실패해도 멈춰 서지 않는다 (끈 뒤 src 를 비울 때 나는 오류는 건너뛴다)
    audio.addEventListener("error", () => { if (ids.length && audio.getAttribute("src")) advanceOnFailure(); });
    let lastTime = 0;
    audio.addEventListener("timeupdate", () => {
      const now = Date.now();
      if (now - lastTime < TIME_EVERY_MS) return;
      lastTime = now;
      send("time");
    });
    audio.addEventListener("loadedmetadata", () => send("time"));
    audio.addEventListener("seeked", () => send("time"));

    // 알림 줄·잠금화면·이어폰 단추 — 다음·이전 곡이 늘 있다
    if (nativeBg && typeof BgPlay !== "undefined") {
      BgPlay.attach(audio, () => titleOf(ids[idx]), () => step(1, false), () => step(-1, false), nativeBg);
    }

    return {
      run(name, args) {
        const fn = commands[name];
        if (!fn) { console.warn("[PlayEngine] 모르는 명령", name); return; }
        return fn(args || {});
      },
      audio
    };
  }

  // ── 브라우저용: 이 화면 안에서 엔진을 돌리고, 화면을 옮길 때는 PlayRelay 로 넘긴다 ──
  function attachBrowserExtras(core) {
    const relay = () => {
      if (typeof PlayRelay === "undefined") return;
      const st = state;   // 덧붙여 둔 전체 상태
      if (!st.ids.length) { PlayRelay.clear(); return; }
      PlayRelay.save({ ids: st.ids, idx: st.idx, pos: st.pos, playing: !st.paused, mode: st.mode, source: st.source });
    };
    window.addEventListener("pagehide", relay);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") relay(); });
    // 잠금화면·이어폰 단추(브라우저가 허락하는 만큼)
    subscribe((st) => {
      if (st.ev === "stop") { relay(); return; }
      if (st.ev !== "track" && st.ev !== "play" && st.ev !== "pause") return;
      relay();
      const ms = navigator.mediaSession;
      if (!ms || !st.id) return;
      try {
        ms.metadata = new MediaMetadata({ title: st.title, artist: "", album: "매일찬양" });
        ms.setActionHandler("play", () => core.run("play"));
        ms.setActionHandler("pause", () => core.run("pause"));
        ms.setActionHandler("previoustrack", () => core.run("prev"));
        ms.setActionHandler("nexttrack", () => core.run("next"));
      } catch (e) { /* 이 브라우저에는 잠금화면 조절이 없다 */ }
    });
  }

  // ── 화면(리모컨) 쪽 ─────────────────────────────────────────────────────
  let state = { ev: "init", ids: [], idx: -1, id: null, title: "", paused: true, ended: false, pos: 0, dur: 0, mode: "repeatAll", source: "", sleepEndAt: 0 };
  const subs = new Set();
  function deliver(st) {
    state = Object.assign({}, state, st);   // "time" 은 바뀐 칸만 온다
    st = state;
    subs.forEach(fn => { try { fn(st); } catch (e) { console.warn("[PlayEngine] 상태를 그리다 오류", e); } });
  }
  function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

  let local = null, remote = null;
  function useLocal() {
    if (local) return;
    remote = null;
    local = createCore(deliver, null);
    attachBrowserExtras(local);
  }
  // 안드로이드 앱이고, 이 화면이 엔진 화면(player.html)이 아니면 리모컨이 된다
  (function boot() {
    if (window.NativeEngine) return;   // 여기가 엔진 화면이다 — host() 가 맡는다
    const p = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BgPlay;
    const native = p && typeof Capacitor.isNativePlatform === "function" && Capacitor.isNativePlatform();
    if (!native) { useLocal(); return; }
    remote = p;
    p.addListener("engine", deliver);
    // 엔진이 없으면(옛 앱·실패) 이 화면 안에서라도 튼다
    p.engine({ cmd: "hello" }).catch(e => { console.warn("[PlayEngine] 엔진 화면이 없어 이 화면에서 틉니다", e); useLocal(); });
  })();

  function cmd(name, args) {
    if (local) return Promise.resolve(local.run(name, args));
    return remote.engine({ cmd: name, args: args || {} }).catch(e => {
      console.warn("[PlayEngine] 명령을 보내지 못했습니다 — 이 화면에서 틉니다", name, e);
      useLocal();
      return local.run(name, args);
    });
  }

  // 브라우저에서만 — 앞 화면이 넘겨준 재생을 이어받는다(앱에서는 엔진이 계속 돌아 필요 없다)
  function adoptRelay() {
    if (!local || state.ids.length || typeof PlayRelay === "undefined") return false;
    const r = PlayRelay.load();
    if (!r) return false;
    local.run("playList", { list: r.ids, start: r.ids[r.idx], mode: r.mode, source: r.source, pos: r.pos, paused: !r.playing });
    return true;
  }

  // ── 엔진 화면(player.html)에서 부른다 — 소리를 내고, 상태를 네이티브로 올린다 ──────
  function host() {
    const N = window.NativeEngine;
    const call = (fn) => { const err = fn(); return err ? Promise.reject(new Error(err)) : Promise.resolve(); };
    // js/bg-play.js 가 Capacitor 플러그인 대신 쓰는 같은 모양의 길
    const nativeBg = {
      start: (o) => call(() => N.bgStart(JSON.stringify(o))),
      paused: (o) => call(() => N.bgPaused(JSON.stringify(o))),
      progress: (o) => call(() => N.bgProgress(JSON.stringify(o))),
      idle: () => call(() => N.bgIdle()),
      stop: () => call(() => N.bgStop()),
      addListener: (ev, fn) => { window.__bgAction = fn; return Promise.resolve({ remove() {} }); }
    };
    const core = createCore((st) => N.post(JSON.stringify(st)), nativeBg);
    window.__engineCmd = (msg) => core.run(msg && msg.cmd, msg && msg.args);
    N.ready();
  }

  return {
    cmd, subscribe, adoptRelay, host, titleOf, MODES,
    get state() { return state; },
    get isRemote() { return !local; }
  };
})();
