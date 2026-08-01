// ============================================================================
// BackupUI — 백업/복원 UI를 각 앱 설정창에 한 줄로 심는 공용 위젯
// ----------------------------------------------------------------------------
// 같은 화면을 앱마다 손으로 만들지 않도록, 컨테이너 하나만 주면 안에
// [백업 만들기] [백업에서 복원] 과 옵션을 채워 준다.
//   BackupUI.mount(el, { scopes:["pray"], title:"매일기도 데이터" })
//   BackupUI.mount(el, { scopes: BackupCore.ALL_SCOPES, title:"전체 백업", all:true })
// ============================================================================
const BackupUI = (() => {

  function _fmtDate(ts) {
    const d = new Date(ts), p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  }

  function mount(el, opts) {
    if (!el) return;
    const scopes = opts.scopes;
    const all = !!opts.all;
    const label = opts.title || "데이터";
    // 찬양 음원(mp3)이 포함될 수 있는 범위일 때만 음원 옵션을 보여 준다
    const canHeavy = scopes.includes("praise");
    const uid = "bk-" + Math.random().toString(36).slice(2, 7);

    el.innerHTML = `
      <div class="bk-box">
        <div class="bk-desc">${all
          ? "모든 앱의 데이터를 하나의 .zip 파일로 담습니다."
          : `${label}만 .zip 파일로 담습니다. 전체 백업은 첫화면 ⚙ 설정에 있습니다.`}</div>
        ${canHeavy ? `<label class="bk-opt"><input type="checkbox" id="${uid}-heavy"><span>찬양 음원(mp3) 파일도 함께 담기
          <span class="bk-hint">— 끄면 곡 목록만(작음), 켜면 음원까지(수백 MB일 수 있음)</span></span></label>` : ""}
        <div class="bk-row">
          <button class="bk-btn bk-go" id="${uid}-export">📤 백업 만들기</button>
          <button class="bk-btn" id="${uid}-import">📥 백업에서 복원</button>
        </div>
        <input type="file" id="${uid}-file" accept=".zip" hidden>
        <div class="bk-status" id="${uid}-status"></div>
      </div>`;

    const $ = (s) => el.querySelector(s);
    const status = $(`#${uid}-status`);
    const say = (m) => { status.textContent = m; };

    if (all) {
      const d = BackupCore.daysSinceBackup();
      const t = BackupCore.lastBackupAt();
      say(t ? `마지막 백업: ${_fmtDate(t)} (${d === 0 ? "오늘" : d + "일 전"})` : "아직 백업한 적이 없습니다");
    }

    $(`#${uid}-export`).addEventListener("click", async () => {
      if (!(await BackupCore.ensureJSZip())) { say("백업 도구를 불러오지 못했습니다"); return; }
      const heavy = canHeavy && $(`#${uid}-heavy`).checked;
      say("백업 만드는 중…" + (heavy ? " (음원 포함 — 시간이 걸립니다)" : ""));
      try {
        const zip = await BackupCore.create(scopes, { includeHeavy: heavy });
        const name = all ? `항상예수께로_전체백업_${BackupCore.dateStr()}.zip`
                         : `${label.replace(/\s+/g, "")}_백업_${BackupCore.dateStr()}.zip`;
        await BackupCore.download(zip, name);
        if (all) BackupCore.markBackedUp();   // 리마인더 기준은 '전체 백업'만
        say("✓ 백업 완료 — 안전한 곳에 보관해 주세요");
      } catch (e) { say("백업 실패: " + e.message); }
    });

    $(`#${uid}-import`).addEventListener("click", () => $(`#${uid}-file`).click());
    $(`#${uid}-file`).addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (!(await BackupCore.ensureJSZip())) { say("복원 도구를 불러오지 못했습니다"); return; }
      // 덮어쓰기는 되돌릴 수 없으므로 두 번 묻는다
      const overwrite = confirm(
        "복원 방식을 골라 주세요.\n\n" +
        "[확인] 덮어쓰기 — 지금 기기의 해당 데이터를 지우고 백업 내용으로 바꿉니다\n" +
        "[취소] 합치기 — 지금 것을 두고 백업 내용을 더합니다 (권장)");
      if (overwrite && !confirm("정말 덮어쓸까요?\n지금 기기에만 있는 내용은 사라집니다. 되돌릴 수 없습니다.")) return;
      say("복원 중…");
      try {
        const r = await BackupCore.restore(file, { mode: overwrite ? "overwrite" : "merge" });
        say(`✓ ${overwrite ? "덮어쓰기" : "합치기"} 복원 완료 — 화면을 새로 불러옵니다`);
        setTimeout(() => location.reload(), 900);
      } catch (e) { say("복원 실패: " + e.message); }
    });
  }

  // 공용 스타일 — 각 앱 CSS를 건드리지 않도록 한 번만 주입
  function injectCSS() {
    if (document.getElementById("bk-css")) return;
    const s = document.createElement("style");
    s.id = "bk-css";
    s.textContent =
      ".bk-box{font-size:13px}" +
      ".bk-desc{color:var(--dim,var(--text-dim,#8b90a8));line-height:1.6;margin-bottom:8px}" +
      // 체크박스와 글이 한 줄에서 시작하도록 (허브 설정처럼 input이 100% 폭인
      // 화면에서도 어긋나지 않게 width를 명시)
      ".bk-opt{display:flex;align-items:flex-start;gap:7px;margin:6px 0 10px;cursor:pointer;line-height:1.5}" +
      // 각 페이지의 폼 CSS(예: 허브의 "#hub-set input{width:100%}")가 우선순위로
      // 이겨서 체크박스가 한 줄을 통째로 차지하던 문제 — 여기서만 확실히 눌러 둔다
      ".bk-opt input{width:16px!important;height:16px!important;flex:0 0 auto;margin:2px 0 0!important;padding:0!important}" +
      ".bk-opt>span{flex:1}" +
      ".bk-hint{color:var(--dim,var(--text-dim,#8b90a8));font-size:11.5px}" +
      ".bk-row{display:flex;gap:8px}" +
      ".bk-btn{flex:1;padding:10px 0;border-radius:10px;cursor:pointer;font-size:13px;font-weight:700;" +
      "background:var(--surface,var(--card,rgba(127,127,127,.12)));color:var(--text,#e8e9f0);" +
      "border:1px solid var(--line,rgba(127,127,127,.25));font-family:inherit}" +
      ".bk-btn.bk-go{background:var(--gold,#c9a84c);color:#1c1608;border-color:transparent}" +
      ".bk-status{margin-top:8px;font-size:12px;color:var(--dim,var(--text-dim,#8b90a8));line-height:1.5}";
    document.head.appendChild(s);
  }

  return { mount, injectCSS };
})();
