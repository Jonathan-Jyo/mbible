// ============================================================================
// 처음 안내 — 앱을 처음 켜거나 브라우저로 처음 들어왔을 때 **한 번만** 크게 띄운다
// ----------------------------------------------------------------------------
// 어느 화면으로 먼저 들어오든 거기서 뜬다(처음 보일 화면을 성경·암송 등으로 고를 수 있어서).
// 그래서 모든 화면이 이 파일을 싣는다.
//
//   bible-welcome-seen  "1" 이면 이미 봤다 — 다시 띄우지 않는다
//   bible-welcome-off   "1" 이면 끔 — 전체 설정 › 앱 안내에서 정한다
// 두 열쇠 모두 bible-reader- 등 백업 열쇠가 아니다 — 이 기기에서 봤는지는 기기마다 따로다.
//
//   Welcome.show()      지금 띄운다(설정의 「안내문 다시 보기」)
// ============================================================================
(function () {
  "use strict";

  const SEEN = "bible-welcome-seen";
  const OFF = "bible-welcome-off";
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  const HTML = `
    <div class="wl-card" role="dialog" aria-modal="true" aria-labelledby="wl-title">
      <div class="wl-star" aria-hidden="true">✦</div>
      <h2 id="wl-title">기록은 이 기기 안에만 남습니다</h2>
      <p class="wl-lead">「항상 예수께로」에는 회원가입도, 기록을 모아 두는 서버도 없습니다.</p>
      <ul class="wl-list">
        <li><b>이 기기에만 저장</b>
          <span>성경 읽기·암송·기도·감사·나눔의 모든 기록은 지금 쓰는 이 기기(앱, 또는 이 브라우저) 안에만 저장됩니다. 인터넷으로 보내지 않습니다.</span></li>
        <li><b>지우면 함께 사라짐</b>
          <span>앱을 지우거나 브라우저의 사이트 데이터·방문 기록을 지우면 기록도 함께 지워지고 되살릴 수 없습니다. 브라우저마다 따로 저장되므로 크롬에 쓴 기록은 사파리에 보이지 않습니다.</span></li>
        <li><b>옮길 때는 백업</b>
          <span>첫화면 ⚙ 전체 설정 › 백업에서 파일로 내려받아, 새 기기에서 그 파일을 불러오면 그대로 이어집니다. 가끔 백업해 두시면 안심입니다.</span></li>
        <li><b>말로 입력(🎙)은 기기의 음성 인식을 거침</b>
          <span>말한 소리를 글로 바꾸는 일은 기기의 음성 인식(대개 구글)이 합니다. 휴대폰 설정에서 한국어 <b class="wl-em">오프라인 음성 팩</b>을 설치해 두면 소리가 바깥으로 나가지 않고 기기 안에서만 처리됩니다(안드로이드 앱). 꺼려지면 첫화면 ⚙ 전체 설정 › 앱 안내에서 <b class="wl-em">말로 입력을 끌 수</b> 있습니다.</span></li>
      </ul>
      <p class="wl-fine">구글드라이브 첨부 복사는 직접 켤 때만 씁니다.</p>
      <button type="button" class="wl-ok">알겠습니다</button>
      <p class="wl-hint">이 안내는 전체 설정 › 앱 안내에서 다시 보거나 끌 수 있습니다.</p>
    </div>`;

  const CSS = `
    .wl-back { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
      padding: max(20px, env(safe-area-inset-top)) 18px max(20px, env(safe-area-inset-bottom));
      background: rgba(8, 10, 18, 0.72); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
      animation: wlFade .25s ease; overflow-y: auto; }
    .wl-card { width: 100%; max-width: min(560px, var(--sheet-w, 560px)); margin: auto;
      background: linear-gradient(170deg, #1b2036, #141827); color: #eef0f6;
      border: 1px solid rgba(217, 180, 91, 0.35); border-radius: 22px; padding: 28px 24px 22px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5); font-family: -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
    .wl-star { text-align: center; font-size: 30px; color: #d9b45b; }
    .wl-card h2 { margin: 6px 0 8px; text-align: center; font-size: 22px; line-height: 1.35; font-weight: 800; }
    .wl-lead { margin: 0 0 18px; text-align: center; font-size: 15px; line-height: 1.6; color: #c9cede; }
    .wl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    .wl-list li { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px; padding: 13px 15px; }
    .wl-list b { display: block; font-size: 16px; color: #d9b45b; margin-bottom: 4px; }
    .wl-list .wl-em { display: inline; font-size: inherit; color: #fff; margin: 0; }
    .wl-list span { display: block; font-size: 15px; line-height: 1.65; color: #e6e8f0; word-break: keep-all; }
    .wl-fine { margin: 14px 2px 0; font-size: 12.5px; line-height: 1.6; color: #a3a9bd; word-break: keep-all; }
    .wl-ok { display: block; width: 100%; margin-top: 18px; padding: 15px 0; border: none; border-radius: 14px;
      background: #d9b45b; color: #1c1608; font: inherit; font-size: 17px; font-weight: 800; cursor: pointer; }
    .wl-ok:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
    .wl-hint { margin: 10px 0 0; text-align: center; font-size: 12px; color: #8f95a8; }
    @media (min-width: 700px) { .wl-card { padding: 34px 32px 26px; } .wl-card h2 { font-size: 25px; } }
    @keyframes wlFade { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .wl-back { animation: none; } }`;

  function show() {
    if (document.querySelector(".wl-back")) return;
    if (!document.getElementById("wl-style")) {
      const st = document.createElement("style"); st.id = "wl-style"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    const back = document.createElement("div");
    back.className = "wl-back";
    back.innerHTML = HTML;
    document.body.appendChild(back);
    const ok = back.querySelector(".wl-ok");
    const close = () => { set(SEEN, "1"); back.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); close(); } };
    ok.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    setTimeout(() => ok.focus(), 50);
  }

  // 처음 한 번 — 이미 봤거나 끈 경우엔 띄우지 않는다
  function maybeShow() {
    if (get(OFF) === "1" || get(SEEN) === "1") return;
    show();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", maybeShow);
  else maybeShow();

  window.Welcome = {
    show,
    get off() { return get(OFF) === "1"; },
    // 켜면 다음에 앱을 열 때 한 번 더 보인다(봤다는 표시를 지운다). 끄면 다시는 안 보인다.
    setOn(on) { if (on) { set(OFF, "0"); try { localStorage.removeItem(SEEN); } catch (e) {} } else set(OFF, "1"); }
  };
})();
