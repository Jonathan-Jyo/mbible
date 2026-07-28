// ============================================================================
// DriveSync — 첨부파일을 구글드라이브 지정 폴더로 복사
// ----------------------------------------------------------------------------
// · Google Identity Services(OAuth) 토큰 방식 — 온라인에서만 동작
// · 최초 1회 준비물: Google Cloud 콘솔에서 만든 OAuth 클라이언트 ID
//   (docs/DRIVE-SETUP.md 참고). 허브 설정에서 입력하면 이 기기에 저장된다.
// · 권한 범위는 drive.file — 이 앱이 만든 파일·폴더만 접근 (전체 드라이브 접근 아님)
// · 저장 폴더는 이름으로 지정: 없으면 만들고, 있으면 그 폴더를 재사용
// ============================================================================

const DriveSync = (() => {
  const K_CFG = "bible-drive-config";     // { clientId, folderName, folderId }
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  let _token = null, _tokenAt = 0;

  function config() { try { return JSON.parse(localStorage.getItem(K_CFG) || "null") || {}; } catch (e) { return {}; } }
  function saveConfig(patch) {
    const c = Object.assign({}, config(), patch);
    localStorage.setItem(K_CFG, JSON.stringify(c));
    return c;
  }
  function isConfigured() { const c = config(); return !!(c.clientId && c.folderName); }

  function _loadGis() {
    return new Promise((resolve, reject) => {
      if (window.google && google.accounts) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("구글 로그인 스크립트를 불러오지 못했습니다 (오프라인?)"));
      document.head.appendChild(s);
    });
  }

  async function _ensureToken() {
    if (_token && Date.now() - _tokenAt < 45 * 60000) return _token;
    const c = config();
    if (!c.clientId) throw new Error("드라이브 설정이 필요합니다 — 허브 ⚙ 설정에서 클라이언트 ID를 입력해 주세요");
    await _loadGis();
    return new Promise((resolve, reject) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: c.clientId, scope: SCOPE,
        callback: (r) => {
          if (r.error) return reject(new Error("구글 인증 실패: " + r.error));
          _token = r.access_token; _tokenAt = Date.now(); resolve(_token);
        }
      });
      tc.requestAccessToken({ prompt: _token ? "" : "consent" });
    });
  }

  async function _api(path, opts) {
    const token = await _ensureToken();
    const res = await fetch("https://www.googleapis.com/" + path, Object.assign({}, opts, {
      headers: Object.assign({ Authorization: "Bearer " + token }, (opts && opts.headers) || {})
    }));
    if (!res.ok) throw new Error(`드라이브 요청 실패 (${res.status})`);
    return res.json();
  }

  // 설정된 이름의 폴더를 찾거나 만들어 id 반환 (한 번 찾으면 기억)
  async function _ensureFolder() {
    const c = config();
    if (c.folderId) return c.folderId;
    const name = c.folderName || "나의매일성경";
    const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const found = await _api(`drive/v3/files?q=${q}&fields=files(id)`);
    let id = found.files && found.files[0] && found.files[0].id;
    if (!id) {
      const created = await _api("drive/v3/files", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" })
      });
      id = created.id;
    }
    saveConfig({ folderId: id });
    return id;
  }

  // 첨부 1건 업로드 (multipart) → AttachStore에 drive 표식 기록
  async function uploadAttachment(att) {
    const folderId = await _ensureFolder();
    const meta = { name: att.name, parents: [folderId] };
    const boundary = "bible" + Date.now();
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${att.mime}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    const body = new Blob([head, att.blob, tail]);
    const token = await _ensureToken();
    const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    });
    if (!res.ok) throw new Error(`업로드 실패 (${res.status})`);
    const file = await res.json();
    if (window.AttachStore) await AttachStore.update(att.id, { drive: { fileId: file.id, at: Date.now() } });
    return file.id;
  }

  // 아직 안 올라간 첨부 전부 복사 — 결과 요약 반환
  async function uploadPending(onProgress) {
    const all = await AttachStore.listAll();
    const todo = all.filter(a => !a.drive);
    let ok = 0, fail = 0;
    for (const att of todo) {
      try { await uploadAttachment(att); ok++; }
      catch (e) { fail++; }
      if (onProgress) onProgress(ok + fail, todo.length);
    }
    return { total: todo.length, ok, fail };
  }

  return { config, saveConfig, isConfigured, uploadAttachment, uploadPending };
})();
