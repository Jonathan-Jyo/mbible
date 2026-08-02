// ============================================================================
// HymnFolder — 찬미가 음원을 기기 폴더에서 바로 읽어 쓴다
// ----------------------------------------------------------------------------
// 음원을 APK에 담지 않는다. 859곡이면 2~3GB이고, 음정 변형까지 더하면 수십 GB다.
// 성경 자료(.bdb)를 따로 넣어 쓰듯, 음원도 기기의 폴더 하나를 정해 두고
// 거기서 읽는다. 앱을 새로 깔아도 폴더는 남으므로 다시 받을 일이 없다.
//
// 폴더 생김새 —  문서(Documents)/항상예수께로_찬미/
//   ├ 연합회/          … 출처별로 나눠 담을 수 있다
//   │   ├ 반주/   … 사람 목소리 없는 MR
//   │   │   ├ 001.mp3
//   │   │   ├ 444.mp3
//   │   │   └ 444_pitch_-2_tempo_0_pitched.mp3  ← 음정 다른 것도 두면 조절된다
//   │   └ 찬양/   … 함께 부르는 음원
//   └ SDApraise/
//       └ 찬양/
//
// 출처를 나누는 까닭 — 같은 곡의 찬양을 여러 곳에서 구할 수 있는데, 한 칸에
// 몰아넣으면 나중 것이 앞엣것을 덮어써 무엇을 듣고 있는지 알 수 없게 된다.
//
// 출처 칸 없이 곧바로 반주/·찬양/ 을 두어도 되고(예전 방식 그대로),
// 하위 폴더 없이 mp3만 넣어 두면 전부 '반주'로 본다.
// 같은 곡이 여러 출처에 있으면 이름 순으로 앞선 출처를 쓴다.
// 파일 이름은 숫자만 맞으면 된다 — 001.mp3 / 1.mp3 / 444 주 예수.mp3 다 읽는다.
//
// 읽는 방법은 기기마다 다르다.
//  · APK(Capacitor): 문서 폴더를 바로 읽는다. 재생은 convertFileSrc 로 흘려보내
//    통째로 메모리에 올리지 않는다(3MB짜리를 수백 개 올릴 수는 없다)
//  · PC 브라우저: 폴더 선택 창으로 한 번 고르면 그 뒤로 기억한다
// ============================================================================

const HymnFolder = (() => {
  const FOLDER = "항상예수께로_찬미";
  const SUB = { mr: "반주", song: "찬양" };
  const ROLE_LABEL = { mr: "반주", song: "찬양" };
  const K_IDX  = "bible-hymn-folder-idx";    // 훑어 둔 목록 (다시 훑지 않도록)
  const K_ROLE = "bible-hymn-role";          // 지금 고른 종류 (mr | song)
  const K_SRCS = "bible-hymn-folder-srcs";   // 폴더에서 찾은 출처 칸 이름들
  const DB = "bible-hymndir", STORE = "handles";

  const cap = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Filesystem) || null;
  const canPick = () => typeof window.showDirectoryPicker === "function";
  const isSupported = () => !!cap() || canPick();

  const _load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  const _save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // ── 지금 무엇으로 들을 것인가 (반주 / 찬양) ──────────────────────────
  function role() { const r = localStorage.getItem(K_ROLE); return r === "song" ? "song" : "mr"; }
  function setRole(r) { try { localStorage.setItem(K_ROLE, r === "song" ? "song" : "mr"); } catch (e) {} }
  function roleLabel(r) { return ROLE_LABEL[r || role()]; }

  // ── 브라우저: 고른 폴더를 기억 ───────────────────────────────────────
  function _hdb() {
    return new Promise((res, rej) => {
      const q = indexedDB.open(DB, 1);
      q.onupgradeneeded = () => { if (!q.result.objectStoreNames.contains(STORE)) q.result.createObjectStore(STORE); };
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  }
  function _htx(mode, fn) {
    return _hdb().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => res(out && typeof out === "object" && "result" in out ? out.result : out);
      tx.onerror = () => rej(tx.error);
    }));
  }
  let _dirCache = null;
  async function _dir(forceNew) {
    if (_dirCache && !forceNew) return _dirCache;
    let h = forceNew ? null : await _htx("readonly", os => os.get("dir")).catch(() => null);
    if (h) {
      const p = await h.queryPermission({ mode: "read" });
      if (p !== "granted" && (await h.requestPermission({ mode: "read" })) !== "granted") h = null;
    }
    if (!h) {
      h = await window.showDirectoryPicker({ mode: "read" });
      await _htx("readwrite", os => os.put(h, "dir"));
    }
    return (_dirCache = h);
  }

  // ── 파일 이름 읽기 ───────────────────────────────────────────────────
  // 444.mp3 / 001.mp3 / 444 주 예수.mp3 / 444_pitch_-2_tempo_0_pitched.mp3
  function parseName(name) {
    if (!/\.(mp3|m4a|aac|ogg|wav|opus)$/i.test(name)) return null;
    const base = name.replace(/\.[^.]+$/, "");
    const num = base.match(/(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/);
    if (!num) return null;
    const p = base.match(/_pitch_(-?\d+)/i);
    return { num: +num[1], pitch: p ? +p[1] : 0, file: name };
  }

  // ── 폴더 훑기 ────────────────────────────────────────────────────────
  // 결과: { mr: { "444": { "0": { f:"444.mp3", s:"연합회" } } }, song: {…} }
  //   f = 파일 이름, s = 출처 칸 이름(없으면 "")
  async function scan() {
    const idx = { mr: {}, song: {} };
    const srcs = new Set();
    // 먼저 넣은 출처가 이긴다 — 이름 순으로 돌기 때문에 앞선 출처가 우선이다
    const put = (r, e, src) => {
      const bag = (idx[r][e.num] = idx[r][e.num] || {});
      if (bag[e.pitch]) return;
      bag[e.pitch] = { f: e.file, s: src || "" };
      if (src) srcs.add(src);
    };

    if (cap()) {
      const FS = cap();
      const readdir = async (path) => {
        try { const r = await FS.readdir({ path, directory: "DOCUMENTS" }); return r.files || []; }
        catch (e) { return []; }
      };
      const root = await readdir(FOLDER);
      const dirs = root.filter(f => f.type === "directory").map(f => f.name || f).sort();
      // ① 출처 칸 (반주/·찬양/ 이 아닌 폴더) 안의 반주/·찬양/
      for (const d of dirs) {
        if (Object.values(SUB).includes(d)) continue;
        for (const [r, sub] of Object.entries(SUB)) {
          (await readdir(`${FOLDER}/${d}/${sub}`))
            .forEach(f => { const e = parseName(f.name || f); if (e) put(r, e, d); });
        }
      }
      // ② 뿌리 바로 아래의 반주/·찬양/ (출처를 나누지 않은 경우)
      for (const [r, sub] of Object.entries(SUB)) {
        (await readdir(`${FOLDER}/${sub}`))
          .forEach(f => { const e = parseName(f.name || f); if (e) put(r, e, ""); });
      }
      // ③ 뿌리에 흩어진 mp3 — 반주로 본다
      root.forEach(f => {
        if (f.type === "directory") return;
        const e = parseName(f.name || f); if (e) put("mr", e, "");
      });
    } else {
      const dir = await _dir(false);
      const subs = {};
      for await (const [nm, h] of dir.entries()) {
        if (h.kind === "directory") subs[nm] = h;
        else { const e = parseName(nm); if (e) put("mr", e, ""); }
      }
      const readInto = async (handle, role, src) => {
        for await (const [nm, fh] of handle.entries()) {
          if (fh.kind !== "file") continue;
          const e = parseName(nm); if (e) put(role, e, src);
        }
      };
      for (const d of Object.keys(subs).sort()) {
        if (Object.values(SUB).includes(d)) continue;
        for (const [r, sub] of Object.entries(SUB)) {
          try { await readInto(await subs[d].getDirectoryHandle(sub), r, d); } catch (e) {}
        }
      }
      for (const [r, sub] of Object.entries(SUB)) {
        if (subs[sub]) await readInto(subs[sub], r, "");
      }
    }
    _save(K_IDX, idx);
    _save(K_SRCS, [...srcs].sort());
    return idx;
  }
  function sources() { return _load(K_SRCS, []); }
  function index() { return _load(K_IDX, { mr: {}, song: {} }); }
  function clear() { try { localStorage.removeItem(K_IDX); } catch (e) {} _dirCache = null; }
  function count(r) { return Object.keys(index()[r] || {}).length; }
  function isLinked() { return count("mr") + count("song") > 0; }

  // 이 곡에 무엇이 있는가 — { roles:["mr","song"], pitches:[-2,0,2] }
  function have(num) {
    const idx = index(), k = String(num);
    const roles = Object.keys(SUB).filter(r => idx[r] && idx[r][k]);
    const cur = idx[role()] && idx[role()][k];
    const pitches = cur ? Object.keys(cur).map(Number).sort((a, b) => a - b) : [];
    return { roles, pitches, src: srcOf(num, role()) };
  }
  // 이 곡을 어느 출처 칸에서 가져오는지
  function srcOf(num, r) {
    const bag = (index()[r] || {})[String(num)] || {};
    const hit = bag["0"] ?? bag[Object.keys(bag)[0]];
    return hit && typeof hit === "object" ? (hit.s || "") : "";
  }

  // ── 재생할 주소 만들기 ───────────────────────────────────────────────
  async function urlFor(num, r, pitch) {
    const idx = index();
    const bag = idx[r] && idx[r][String(num)];
    if (!bag) return null;
    const hit = bag[String(pitch || 0)] ?? bag["0"] ?? bag[Object.keys(bag)[0]];
    if (!hit) return null;
    // 예전 방식(문자열)으로 저장된 목록도 그대로 읽는다
    const file = typeof hit === "string" ? hit : hit.f;
    const src  = typeof hit === "string" ? "" : (hit.s || "");
    const sub = SUB[r];

    if (cap()) {
      const FS = cap();
      // 출처 칸 → 뿌리 아래 → 뿌리 — 훑을 때와 같은 차례로 찾는다
      const tries = src ? [`${FOLDER}/${src}/${sub}/${file}`] : [];
      tries.push(`${FOLDER}/${sub}/${file}`, `${FOLDER}/${file}`);
      for (const path of tries) {
        try {
          const { uri } = await FS.getUri({ path, directory: "DOCUMENTS" });
          // 통째로 읽지 않고 흘려보낸다 — 큰 파일도 바로 재생되고 탐색도 된다
          return window.Capacitor.convertFileSrc(uri);
        } catch (e) {}
      }
      return null;
    }
    const dir = await _dir(false);
    const paths = [];
    if (src) paths.push([src, sub]);
    paths.push([sub], []);
    for (const parts of paths) {
      try {
        let h = dir;
        for (const seg of parts) h = await h.getDirectoryHandle(seg);
        return URL.createObjectURL(await (await h.getFileHandle(file)).getFile());
      } catch (e) {}
    }
    return null;
  }

  async function link(forceNew) {
    if (cap()) return scan();          // APK는 정해진 문서 폴더를 그대로 쓴다
    await _dir(!!forceNew);
    return scan();
  }

  return {
    FOLDER, SUB, isSupported, isCap: () => !!cap(),
    role, setRole, roleLabel,
    link, scan, index, clear, count, isLinked, have, srcOf, sources, urlFor, parseName
  };
})();

// ── HymnSource 에 폴더를 "먼저 보는 곳"으로 끼워 넣는다 ────────────────
// 폴더는 묶음(pack)과 성격이 달라 앞자리에 둔다. 폴더에 없으면 묶음으로 넘어간다.
if (typeof HymnSource !== "undefined") {
  HymnSource.register("folder", {
    label: "내 폴더",
    caps: { tempo: true, pitch: false, offline: true },   // 음정은 곡마다 다르므로 resolve 가 알려 준다
    async create(ref, mount) {
      const [r, num, pitch] = String(ref).split(":");
      const url = await HymnFolder.urlFor(+num, r, +pitch || 0);
      if (!url) throw new Error("폴더에서 음원 파일을 찾지 못했습니다.");
      const el = document.createElement("audio");
      el.preload = "metadata"; el.preservesPitch = true; el.src = url;
      mount.appendChild(el);
      return {
        el,
        play: () => el.play(), pause: () => el.pause(),
        seek: (t) => { try { el.currentTime = t; } catch (e) {} },
        time: () => el.currentTime || 0,
        duration: () => (isFinite(el.duration) ? el.duration : 0),
        playing: () => !el.paused && !el.ended,
        setRate: (x) => { el.preservesPitch = true; el.playbackRate = x; },
        setLoop: (on) => { el.loop = !!on; },
        on: (ev, cb) => el.addEventListener(ev === "end" ? "ended" : ev === "tick" ? "timeupdate" : ev, cb),
        destroy: () => { try { el.pause(); } catch (e) {} if (url.startsWith("blob:")) URL.revokeObjectURL(url); el.remove(); }
      };
    }
  });

  const _folderSrc = (num, r, wantPitch) => {
    const idx = (HymnFolder.index()[r] || {})[String(num)] || {};
    const pitches = Object.keys(idx).map(Number).sort((a, b) => a - b);
    if (!pitches.length) return null;
    const pitch = pitches.includes(wantPitch || 0) ? (wantPitch || 0) : 0;
    return {
      kind: "folder",
      ref: `${r}:${num}:${pitch}`,
      from: `${HymnFolder.srcOf(num, r) || "내 폴더"} · ${HymnFolder.roleLabel(r)}`,
      roles: HymnFolder.have(num).roles, role: r, pitches,
      caps: { tempo: true, pitch: pitches.length > 1, offline: true }
    };
  };

  const provider = (num, opt) => {
    if (!HymnFolder.isLinked()) return null;
    const want = (opt && opt.role) || HymnFolder.role();
    const got = _folderSrc(num, want, opt && opt.pitch);
    if (got) return got;
    // 고른 종류가 폴더에 없다 —
    //  · 1차(strictRole)에는 물러난다. 인터넷 음원이라도 그 종류로 듣는 편이 낫다
    //  · 2차에는 폴더에 있는 다른 종류라도 내놓는다
    if (opt && opt.strictRole) return null;
    const other = HymnFolder.have(num).roles[0];
    return other ? _folderSrc(num, other, opt && opt.pitch) : null;
  };
  // 이 곡에 폴더가 가진 것 전부 (사용자가 직접 고를 때 쓴다)
  provider.all = (num) => HymnFolder.have(num).roles.map(r => _folderSrc(num, r, 0)).filter(Boolean);
  HymnSource.addProvider(provider);
}
