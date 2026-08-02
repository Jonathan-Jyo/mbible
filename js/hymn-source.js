// ============================================================================
// HymnSource — 찬미가 반주 음원을 "갈아 끼울 수 있게" 다루는 층
// ----------------------------------------------------------------------------
// 음원을 한 곳(예: 유튜브)에 못 박아 두면 나중에 더 좋은 반주가 생겨도 못 쓴다.
// 그래서 "곡 번호 → 음원"을 자료로 두고, 재생하는 방법은 어댑터로 갈아 끼운다.
//
//   ┌ 음원 묶음(pack)  … 번호↔음원 표. 여러 개를 두고 순서·사용 여부를 정한다
//   ├ 곡별 지정(pick)  … 특정 곡만 다른 음원으로 (묶음보다 우선)
//   └ 어댑터(adapter)  … 종류별 재생 방법. youtube / audio / (뒷날) midi
//
// 새 음원 방식이 생기면 어댑터 하나만 register 하면 된다. 화면은 손대지 않는다.
//
// ── 음정과 박자에 대하여 ──────────────────────────────────────────────
// 브라우저의 preservesPitch 가 기본 true 라서, 배속(playbackRate)을 바꾸면
// **음정은 그대로 두고 박자만** 바뀐다(유튜브도 같은 방식이다).
// 그래서 박자 조절은 지금 방식으로도 제대로 된다.
// 반면 음정만 따로 내리는 것은 미디어 요소 하나로는 불가능하다 — MIDI 어댑터
// (또는 실시간 음높이 변환)가 들어와야 열린다. 그래서 어댑터마다 caps 로
// "무엇을 할 수 있는지" 밝히고, 화면은 그에 맞춰 조절 버튼을 열고 닫는다.
// ============================================================================

const HymnSource = (() => {
  const K_PACKS = "bible-hymn-packs";   // [{id,name,kind,enabled,items:{"1":ref,…}}]
  const K_PICK  = "bible-hymn-pick";    // {"305":{kind,ref}} — 곡별 직접 지정

  const _load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  const _save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const _id = () => `hp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // ── 어댑터 등록소 ────────────────────────────────────────────────────
  const ADAPTERS = {};
  function register(kind, ad) { ADAPTERS[kind] = Object.assign({ kind }, ad); }
  function adapter(kind) { return ADAPTERS[kind] || null; }
  function kinds() { return Object.keys(ADAPTERS); }

  // ── 음원 묶음 ────────────────────────────────────────────────────────
  function packs() { const a = _load(K_PACKS, []); return Array.isArray(a) ? a : []; }
  function savePacks(a) { _save(K_PACKS, a); }
  function addPack(p) {
    const arr = packs();
    // role: "mr"(반주) | "song"(찬양) | null(가리지 않음)
    arr.push({ id: _id(), name: p.name || "이름 없는 음원", kind: p.kind,
               role: p.role === "song" ? "song" : (p.role === "mr" ? "mr" : null),
               enabled: true, items: p.items || {} });
    savePacks(arr);
    return arr[arr.length - 1];
  }
  function removePack(id) { savePacks(packs().filter(p => p.id !== id)); }
  function setPackEnabled(id, on) {
    const arr = packs(); const p = arr.find(x => x.id === id);
    if (p) { p.enabled = !!on; savePacks(arr); }
  }
  // 위로/아래로 — 앞에 있는 묶음이 먼저 쓰인다
  function movePack(id, dir) {
    const arr = packs(); const i = arr.findIndex(p => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    savePacks(arr);
  }
  function packCount(p) { return Object.keys(p.items || {}).length; }

  // ── 곡별 직접 지정 ───────────────────────────────────────────────────
  function picks() { return _load(K_PICK, {}) || {}; }
  function setPick(num, src) {
    const all = picks();
    if (src) all[String(num)] = { kind: src.kind, ref: src.ref, name: src.name || "" };
    else delete all[String(num)];
    _save(K_PICK, all);
  }

  // ── 이 곡을 무엇으로 틀 것인가 ───────────────────────────────────────
  // 곡별 지정 → 앞자리 제공자(폴더 등) → 켜 둔 묶음을 순서대로. 없으면 null.
  //
  // 제공자(provider)는 "표에 적어 둔 것"이 아니라 그때그때 살펴봐야 하는 음원을
  // 위한 자리다. 기기 폴더가 그런 경우다 — 파일이 늘고 줄기 때문이다.
  const PROVIDERS = [];
  function addProvider(fn) { PROVIDERS.push(fn); }

  function resolve(num, opt) {
    const k = String(num);
    const p = picks()[k];
    if (p && ADAPTERS[p.kind]) return { kind: p.kind, ref: p.ref, from: p.name || "직접 지정", pick: true };
    for (const fn of PROVIDERS) {
      let r = null; try { r = fn(num, opt || {}); } catch (e) {}
      if (r && ADAPTERS[r.kind]) return r;
    }
    // 지금 고른 종류(반주/찬양)와 맞는 묶음을 먼저 본다. 없으면 가리지 않는 것,
    // 그래도 없으면 종류가 다르더라도 있는 것을 쓴다 — 아무 소리도 안 나는 것보다 낫다.
    const want = (opt && opt.role) || null;
    const rounds = want ? [pk => pk.role === want, pk => !pk.role, () => true]
                        : [pk => !pk.role, () => true];
    for (const ok of rounds) {
      for (const pk of packs()) {
        if (!pk.enabled || !ADAPTERS[pk.kind] || !ok(pk)) continue;
        const ref = pk.items && pk.items[k];
        if (ref) {
          const ad = ADAPTERS[pk.kind];
          return { kind: pk.kind, ref, from: pk.name, packId: pk.id,
                   role: pk.role || null, caps: ad.caps };
        }
      }
    }
    return null;
  }

  // ── 묶음 파일 읽기 ───────────────────────────────────────────────────
  // 여러 생김새를 받아 준다. 남이 만든 표를 그대로 가져다 쓸 수 있어야
  // "갈아 끼운다"는 말이 뜻이 있다.
  //   ① { name, kind, items: { "1": "영상ID", … } }              ← 우리 형식
  //   ② [ { hymn_number: 1, id: "영상ID" }, … ]                   ← 목록 형식
  //   ③ { "1": "영상ID", … }                                      ← 표만
  function parsePack(data, fallbackName, fallbackKind) {
    const kind = (data && data.kind) || fallbackKind || "youtube";
    const role = (data && data.role) || null;
    let name = (data && data.name) || fallbackName || "가져온 음원";
    let items = {};
    if (Array.isArray(data)) {
      data.forEach(row => {
        if (!row) return;
        const n = row.hymn_number ?? row.number ?? row.no ?? row.chapter;
        const ref = row.id ?? row.videoId ?? row.ref ?? row.url;
        if (n != null && ref) items[String(n)] = String(ref);
      });
    } else if (data && data.items && typeof data.items === "object") {
      Object.keys(data.items).forEach(k => { if (/^\d+$/.test(k)) items[k] = String(data.items[k]); });
    } else if (data && typeof data === "object") {
      Object.keys(data).forEach(k => {
        if (/^\d+$/.test(k) && (typeof data[k] === "string" || typeof data[k] === "number")) items[k] = String(data[k]);
      });
    }
    if (!Object.keys(items).length) throw new Error("곡 번호와 음원이 짝지어진 자료를 찾지 못했습니다.");
    return { name, kind, role, items };
  }

  // ── 내 파일 보관소 (오프라인 음원) ───────────────────────────────────
  const Audio_ = {
    DB: "bible-hymn-audio", STORE: "files", _db: null,
    async db() {
      if (this._db) return this._db;
      this._db = await new Promise((res, rej) => {
        const r = indexedDB.open(this.DB, 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(this.STORE)) r.result.createObjectStore(this.STORE, { keyPath: "id" }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return this._db;
    },
    async _tx(mode, fn) {
      const db = await this.db();
      return new Promise((res, rej) => {
        const t = db.transaction(this.STORE, mode);
        const rq = fn(t.objectStore(this.STORE));
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
    },
    save(id, blob) { return this._tx("readwrite", s => s.put({ id, blob, size: blob.size, at: Date.now() })); },
    get(id) { return this._tx("readonly", s => s.get(id)); },
    remove(id) { return this._tx("readwrite", s => s.delete(id)); },
    list() { return this._tx("readonly", s => s.getAll()); },
    async url(id) { const r = await this.get(id); return r && r.blob ? URL.createObjectURL(r.blob) : null; }
  };

  return {
    register, adapter, kinds,
    packs, addPack, removePack, setPackEnabled, movePack, packCount, savePacks,
    picks, setPick, resolve, parsePack, addProvider,
    Audio: Audio_
  };
})();

// ════════════════════════════════════════════════════════════════════════
// 어댑터 ① 소리 파일 — 내가 넣은 mp3, 또는 인터넷 주소
//   ref = "file:<보관 id>"  또는  "http…"
// ════════════════════════════════════════════════════════════════════════
HymnSource.register("audio", {
  label: "소리 파일",
  caps: { tempo: true, pitch: false, offline: true },
  async create(ref, mount) {
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.preservesPitch = true;          // 배속을 바꿔도 음정은 지킨다
    let objUrl = null;
    if (String(ref).startsWith("file:")) {
      objUrl = await HymnSource.Audio.url(String(ref).slice(5));
      if (!objUrl) throw new Error("저장된 소리 파일을 찾지 못했습니다.");
      el.src = objUrl;
    } else {
      el.src = ref;
    }
    mount.appendChild(el);
    return {
      el,
      play: () => el.play(),
      pause: () => el.pause(),
      seek: (t) => { try { el.currentTime = t; } catch (e) {} },
      time: () => el.currentTime || 0,
      duration: () => (isFinite(el.duration) ? el.duration : 0),
      playing: () => !el.paused && !el.ended,
      setRate: (r) => { el.preservesPitch = true; el.playbackRate = r; },
      setLoop: (on) => { el.loop = !!on; },
      on: (ev, cb) => el.addEventListener(ev === "end" ? "ended" : ev === "tick" ? "timeupdate" : ev, cb),
      destroy: () => { try { el.pause(); } catch (e) {} if (objUrl) URL.revokeObjectURL(objUrl); el.remove(); }
    };
  }
});

// ════════════════════════════════════════════════════════════════════════
// 어댑터 ② 유튜브 — ref = 영상 ID (또는 주소)
//   인터넷이 있어야 한다. 배속을 바꿔도 음정은 유지된다(유튜브도 같은 방식).
// ════════════════════════════════════════════════════════════════════════
HymnSource.register("youtube", {
  label: "유튜브",
  caps: { tempo: true, pitch: false, offline: false },
  async create(ref, mount) {
    const id = (String(ref).match(/[\w-]{11}/) || [String(ref)])[0];
    await _ytApi();
    const holder = document.createElement("div");
    mount.appendChild(holder);
    const yt = await new Promise((res, rej) => {
      let done = false;
      const p = new YT.Player(holder, {
        videoId: id,
        playerVars: { playsinline: 1, controls: 0, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => { if (!done) { done = true; res(p); } },
          onError: () => { if (!done) { done = true; rej(new Error("이 영상은 앱 안에서 재생할 수 없습니다.")); } }
        }
      });
      setTimeout(() => { if (!done) { done = true; rej(new Error("유튜브를 불러오지 못했습니다 — 인터넷 연결을 확인해 주세요.")); } }, 12000);
    });
    const subs = {};
    let loop = false;
    // 유튜브는 진행 알림을 주지 않으므로 우리가 눈금을 센다
    const timer = setInterval(() => {
      (subs.tick || []).forEach(f => f());
      try {
        if (yt.getPlayerState && yt.getPlayerState() === YT.PlayerState.ENDED) {
          if (loop) { yt.seekTo(0, true); yt.playVideo(); }
          (subs.end || []).forEach(f => f());
        }
      } catch (e) {}
    }, 500);
    return {
      el: holder,
      play: () => yt.playVideo(),
      pause: () => yt.pauseVideo(),
      seek: (t) => yt.seekTo(t, true),
      time: () => { try { return yt.getCurrentTime() || 0; } catch (e) { return 0; } },
      duration: () => { try { return yt.getDuration() || 0; } catch (e) { return 0; } },
      playing: () => { try { return yt.getPlayerState() === YT.PlayerState.PLAYING; } catch (e) { return false; } },
      setRate: (r) => { try { yt.setPlaybackRate(_ytNearestRate(yt, r)); } catch (e) {} },
      setLoop: (on) => { loop = !!on; },
      on: (ev, cb) => { (subs[ev] = subs[ev] || []).push(cb); },
      destroy: () => { clearInterval(timer); try { yt.destroy(); } catch (e) {} holder.remove(); }
    };
  },
  externalUrl: (ref) => `https://www.youtube.com/watch?v=${(String(ref).match(/[\w-]{11}/) || [ref])[0]}`
});

let _ytApiP = null;
function _ytApi() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (_ytApiP) return _ytApiP;
  _ytApiP = new Promise((res, rej) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === "function") prev(); res(); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => rej(new Error("유튜브를 불러오지 못했습니다 — 인터넷 연결을 확인해 주세요."));
    document.head.appendChild(s);
    setTimeout(() => rej(new Error("유튜브 연결이 지연됩니다 — 인터넷 상태를 확인해 주세요.")), 12000);
  });
  return _ytApiP;
}
// 유튜브는 아무 배속이나 받지 않는다 — 쓸 수 있는 값 중 가장 가까운 것으로
function _ytNearestRate(yt, r) {
  let list = [];
  try { list = yt.getAvailablePlaybackRates() || []; } catch (e) {}
  if (!list.length) return r;
  return list.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a), list[0]);
}
