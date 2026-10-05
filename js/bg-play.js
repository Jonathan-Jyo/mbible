// ============================================================================
// BgPlay — 화면이 꺼져도 <audio> 연속재생이 끊기지 않게 (안드로이드 앱 전용)
// ----------------------------------------------------------------------------
// 안드로이드는 화면이 꺼진 앱을 얼마 뒤 얼리거나 정리한다. 그러면 곡이 끝나도
// 다음 곡으로 못 넘어가고, 심하면 앱 화면까지 닫힌다(몇 곡 뒤 끊기던 까닭).
// 재생하는 동안 네이티브 BgPlayService 를 켜 두어 앱을 음악 앱으로 대접받게 한다
// — 알림 한 줄에 지금 곡 이름이 보인다. 브라우저에서는 아무것도 하지 않는다.
//
//   BgPlay.attach(audio, () => "곡 이름", () => 다음곡(), () => 이전곡())
//
// 알림 단추·잠금화면 플레이어·이어폰(유선·블루투스) 단추가 모두 여기로 온다.
// ⏯ 는 이 <audio> 를 멈추거나 다시 틀고, ⏭·⏮ 는 넘겨받은 다음곡()·이전곡()을 부른다.
// 이전곡()을 넘기지 않은 화면에는 ⏮ 가 나타나지 않는다.
//
// 곡이 바뀔 때 <audio> 는 잠깐 pause 를 냈다가 다시 play 한다. 그 틈에 서비스를
// 껐다 켜면 안 된다 — 안드로이드 12+ 는 화면 뒤에서 새로 켜는 것을 막기 때문이다.
// 그래서 멈춤은 STOP_GRACE_MS 동안 지켜보다가 그사이 다시 재생되지 않을 때만 끈다.
//
// 화면이 꺼진 채 멈췄을 때(잠금화면·이어폰 단추·수면 타이머)는 끄지 않고 CPU 잠금만
// 푼다(idle). 끄면 잠금화면에서 다시 ▶ 했을 때 서비스를 새로 켤 수 없어 또 끊긴다.
// 그래도 HIDDEN_KEEP_MS 동안 다시 듣지 않으면 알림을 거둔다.
// ============================================================================
const BgPlay = (() => {
  const STOP_GRACE_MS = 15000;
  const HIDDEN_KEEP_MS = 30 * 60 * 1000;
  const plugin = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BgPlay) || null;

  function attach(audio, titleOf, onNext, onPrev) {
    const p = plugin();
    if (!p) return;
    let stopTimer = null, keepTimer = null;

    const cancelStop = () => { clearTimeout(stopTimer); clearTimeout(keepTimer); stopTimer = keepTimer = null; };
    const stopNow = () => {
      cancelStop();
      p.stop().catch(e => console.warn("[BgPlay] 끄기 실패", e));
    };
    const hidden = () => document.visibilityState === "hidden";
    // 멈춤을 지켜본다 — 틈이 지나도 그대로 멈춰 있으면 화면을 보는 중엔 끄고, 꺼진 화면이면 잠금만 푼다
    const watchPause = () => {
      cancelStop();
      stopTimer = setTimeout(() => {
        stopTimer = null;
        if (!hidden()) { stopNow(); return; }
        p.idle().catch(e => console.warn("[BgPlay] 잠금 풀기 실패", e));
        keepTimer = setTimeout(stopNow, HIDDEN_KEEP_MS);
      }, STOP_GRACE_MS);
    };

    audio.addEventListener("play", () => {
      cancelStop();
      // 이미 돌고 있으면 알림의 곡 이름만 바뀐다
      p.start({ title: (titleOf && titleOf()) || "", canPrev: !!onPrev })
        .catch(e => console.warn("[BgPlay] 켜지 못함 — 화면이 꺼지면 끊길 수 있습니다", e));
    });
    audio.addEventListener("pause", () => {
      // 곡이 끝나 넘어가는 틈(ended)에는 단추를 ▶ 로 깜박이지 않는다
      if (!audio.ended) p.paused().catch(e => console.warn("[BgPlay] 알림 갱신 실패", e));
      watchPause();
    });
    const play = () => audio.play().catch(e => console.warn("[BgPlay] 다시 틀지 못함", e));
    p.addListener("action", ({ action }) => {
      if (action === "next") { if (onNext) onNext(); }
      else if (action === "prev") { if (onPrev) onPrev(); }
      else if (action === "play") play();
      else if (action === "pause") audio.pause();
      else if (audio.paused) play();   // toggle
      else audio.pause();
    });
    // 꺼진 화면에서 멈춰 둔 채 앱으로 돌아오면 — 이제 화면을 보고 있으니 곧 끈다
    document.addEventListener("visibilitychange", () => {
      if (!hidden() && audio.paused && keepTimer) watchPause();
    });
    // 다른 화면으로 넘어가면 이 <audio> 도 사라진다 — 알림을 남기지 않는다
    window.addEventListener("pagehide", stopNow);
  }

  return { attach };
})();
