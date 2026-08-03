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
  const K_IDX  = "bible-hymn-folder-idx2";   // 훑어 둔 목록 (다시 훑지 않도록 · 출처별)
  const K_OLD  = "bible-hymn-folder-idx";    // 출처를 가르기 전의 목록 — 버린다
  const K_ROLE = "bible-hymn-role";          // 지금 고른 종류 (mr | song)
  const K_SRC  = "bible-hymn-src";           // 지금 고른 출처 칸 ("" = 가리지 않음)
  const K_TREE = "bible-hymn-tree-name";     // 고른 폴더 이름 (화면에 바로 쓰려고)
  const K_SRCS = "bible-hymn-folder-srcs";   // 폴더에서 찾은 출처 칸 이름들
  const DB = "bible-hymndir", STORE = "handles";

  const cap = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Filesystem) || null;
  const saf = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.HymnTree) || null;
  const canPick = () => typeof window.showDirectoryPicker === "function";
  const isSupported = () => !!saf() || !!cap() || canPick();

  // ── 통째로 넘겨받은 폴더 (안드로이드 SAF) ────────────────────────────
  // 7.8GB를 내장으로 옮기게 할 수는 없어서, SD카드에 둔 채로 읽는다.
  // 고른 폴더가 곧 뿌리다 — 이름이 무엇이든 상관없다.
  let _tree = undefined;                       // undefined=아직 안 물어봄, null=없음
  async function tree() {
    if (_tree !== undefined) return _tree;
    const P = saf();
    if (!P) return (_tree = null);
    try { const r = await P.saved(); _tree = r && r.ok ? r : null; }
    catch (e) { _tree = null; }
    return _tree;
  }
  async function pickTree() {
    const P = saf();
    if (!P) return null;
    const r = await P.pick();
    _tree = r && r.ok ? r : null;
    return _tree;
  }
  async function forgetTree() {
    const P = saf();
    if (P) { try { await P.forget(); } catch (e) {} }
    _tree = null;
  }
  // 고른 폴더 이름 — 화면을 그릴 때 바로 필요하므로 적어 두고 쓴다
  function treeName() { return (_tree && _tree.name) || localStorage.getItem(K_TREE) || ""; }

  // 출처 칸 이름. 칸을 나누지 않았으면 고른 폴더 이름을 쓴다.
  // "내 폴더"라고만 적으면 무엇을 듣고 있는지 알 수 없다.
  function srcLabel(s) { return s || treeName() || "내 폴더"; }

  const _load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } };
  const _save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // ── 지금 무엇으로 들을 것인가 (반주 / 찬양) ──────────────────────────
  function role() { const r = localStorage.getItem(K_ROLE); return r === "song" ? "song" : "mr"; }
  function setRole(r) { try { localStorage.setItem(K_ROLE, r === "song" ? "song" : "mr"); } catch (e) {} }
  function roleLabel(r) { return ROLE_LABEL[r || role()]; }
  // 고른 출처 칸 — 반주는 연합회로, 찬양은 SDApraise로 들을 수 있다
  function srcPick() { return localStorage.getItem(K_SRC) || ""; }
  function setPick(r, s) {
    setRole(r);
    try { localStorage.setItem(K_SRC, s || ""); } catch (e) {}
  }

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
  let _tooMany = false;              // 폴더가 너무 커서 훑기를 끊었나
  let _cloud = false;                // 구글 드라이브 같은 구름 폴더인가
  let _slow  = false;                // 목록을 나눠 받았나(구름의 표시)
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
    // 출처마다 따로 담는다. 444장 찬양이 연합회엔 없고 SDApraise엔 있는 일이
    // 흔하므로, 한 출처만 남기면 있는 음원을 못 듣게 된다.
    // 출처별로 칸이 나뉘어 있으니 원곡과 음정이 서로 다른 녹음에서 올 일도 없다.
    const put = (r, e, src) => {
      const s = src || "";
      const song = (idx[r][e.num] = idx[r][e.num] || {});
      const bag  = (song[s] = song[s] || {});
      if (bag[e.pitch]) return;
      bag[e.pitch] = { f: e.file };
      if (e.dir !== undefined) bag[e.pitch].d = e.dir;   // 넘겨받은 폴더는 경로를 그대로 적어 둔다
      if (s) srcs.add(s);
    };

    const T = await tree();
    if (T) {
      // 통째로 넘겨받은 폴더 — 네이티브가 상대 경로만 훑어 준다
      //   ["연합회/반주/001.mp3", "반주/001.mp3", "001.mp3"] 어느 모양이든 읽는다
      const res = await saf().list();
      const roleOf = (n) => Object.keys(SUB).find(k => SUB[k] === n);
      const recs = [];
      for (const path of res.files || []) {
        const parts = String(path).split("/");
        const name = parts.pop();
        const e = parseName(name);
        if (!e) continue;
        let r = "mr", src = "";
        if (parts.length) {
          const rk = roleOf(parts[parts.length - 1]);
          if (rk) { r = rk; src = parts.slice(0, -1).join("/"); }
          else src = parts.join("/");           // 반주/찬양 칸이 없으면 전부 반주로 본다
        }
        e.dir = parts.join("/");                // 재생할 때 되짚어 볼 필요가 없도록
        recs.push({ r, e, src, path });
      }
      // 출처 칸을 이름 순으로 먼저, 뿌리에 흩어진 것은 나중 — 빈자리만 채운다
      recs.sort((a, b) => (a.src ? 0 : 1) - (b.src ? 0 : 1)
                       || a.src.localeCompare(b.src) || a.path.localeCompare(b.path));
      recs.forEach(x => put(x.r, x.e, x.src));
      _tooMany = !!res.cut;
      _cloud = res.local === false;
      _slow = !!res.slow;
    } else if (cap()) {
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
    try { localStorage.setItem(K_TREE, (_tree && _tree.name) || ""); } catch (e) {}
    return idx;
  }
  function sources() { return _load(K_SRCS, []); }
  function index() { return _load(K_IDX, { mr: {}, song: {} }); }
  // 연결 끊기 — 넘겨받은 폴더 권한도 함께 돌려준다
  function clear() {
    try { localStorage.removeItem(K_IDX); localStorage.removeItem(K_OLD); } catch (e) {}
    try { localStorage.removeItem(K_SRC); localStorage.removeItem(K_TREE); } catch (e) {}
    _dirCache = null; _tooMany = false;
    forgetTree();
  }
  function count(r) { return Object.keys(index()[r] || {}).length; }
  function isLinked() { return count("mr") + count("song") > 0; }

  // ── 이 곡을 무엇으로 들을 수 있는가 ──────────────────────────────────
  // 반주·찬양을 출처까지 갈라 늘어놓는다. 같은 종류가 여러 출처에 있으면
  // 번호를 붙인다 — [반주 | 찬양1 | 찬양2] 처럼.
  function options(num) {
    const idx = index(), k = String(num), out = [];
    for (const r of Object.keys(SUB)) {
      const song = (idx[r] || {})[k];
      if (!song) continue;
      // 출처 칸을 이름 순으로, 출처 없이 뿌리에 둔 것은 맨 뒤로
      const list = Object.keys(song).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
      list.forEach((s, i) => out.push({
        role: r, src: s,
        label: ROLE_LABEL[r] + (list.length > 1 ? String(i + 1) : ""),
        title: s || "출처 없음"
      }));
    }
    return out;
  }

  // 지금 고른 것을 이 곡에 맞춰 정한다.
  // 고른 출처가 이 곡엔 없을 수 있다(444장 찬양이 연합회엔 없듯이).
  // 그럴 땐 같은 종류의 다른 출처로, 그것도 없으면 있는 것 아무거나로 물러선다.
  // 고른 값 자체는 그대로 둔다 — 그 출처가 있는 곡으로 가면 다시 살아난다.
  function pickFor(num) {
    const opts = options(num);
    if (!opts.length) return null;
    const r = role(), s = srcPick();
    return opts.find(o => o.role === r && o.src === s)
        || opts.find(o => o.role === r)
        || opts[0];
  }

  function have(num) {
    const opts = options(num);
    const cur = pickFor(num);
    const bag = cur ? ((index()[cur.role] || {})[String(num)] || {})[cur.src] : null;
    const pitches = bag ? Object.keys(bag).map(Number).sort((a, b) => a - b) : [];
    return { options: opts, cur, roles: [...new Set(opts.map(o => o.role))], pitches, src: cur ? cur.src : "" };
  }

  // 이 곡을 어느 출처 칸에서 가져오는지
  function srcOf(num) { const c = pickFor(num); return c ? c.src : ""; }

  // ── 재생할 주소 만들기 ───────────────────────────────────────────────
  async function urlFor(num, r, pitch, wantSrc) {
    const song = (index()[r] || {})[String(num)];
    if (!song) return null;
    // 고른 출처가 이 곡엔 없으면 있는 것으로 물러선다
    const src = (wantSrc != null && song[wantSrc]) ? wantSrc
              : (song[srcPick()] ? srcPick() : Object.keys(song).sort()[0]);
    const bag = song[src];
    if (!bag) return null;
    const hit = bag[String(pitch || 0)] ?? bag["0"] ?? bag[Object.keys(bag)[0]];
    if (!hit) return null;
    const file = hit.f;
    const sub = SUB[r];

    if (hit.d !== undefined && await tree()) {
      // 넘겨받은 폴더 — 훑을 때 적어 둔 경로를 그대로 쓴다
      const rel = hit.d ? `${hit.d}/${file}` : file;
      try {
        const { uri } = await saf().uri({ rel });
        // 통째로 읽지 않고 흘려보낸다 — 3MB짜리 수천 개를 메모리에 올릴 수는 없다
        return window.Capacitor.convertFileSrc(uri);
      } catch (e) { return null; }
    }
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
    if (saf()) {
      // 폴더를 통째로 넘겨받는다. 한 번 고르면 기억하므로 다시 묻지 않는다.
      const t = forceNew ? await pickTree() : (await tree()) || await pickTree();
      if (!t) return null;             // 사용자가 취소했다
      return scan();
    }
    if (cap()) return scan();          // 예전 APK — 정해진 문서 폴더를 그대로 쓴다
    await _dir(!!forceNew);
    return scan();
  }

  return {
    FOLDER, SUB, isSupported, isCap: () => !!cap(),
    isTree: () => !!saf(), tree, treeName, pickTree, forgetTree,
    tooMany: () => _tooMany, isCloud: () => _cloud, wasSlow: () => _slow,
    role, setRole, roleLabel, srcPick, setPick, options, pickFor, srcLabel,
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
      // 출처 칸 이름에 ':' 이 들어 있어도 되도록 뒤쪽은 다시 이어 붙인다
      const [r, num, pitch, ...rest] = String(ref).split(":");
      const url = await HymnFolder.urlFor(+num, r, +pitch || 0, rest.join(":"));
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

  const _folderSrc = (num, r, wantPitch, src) => {
    const song = (HymnFolder.index()[r] || {})[String(num)] || {};
    const use = song[src] ? src : Object.keys(song).sort()[0];
    const bag = song[use];
    if (!bag) return null;
    const pitches = Object.keys(bag).map(Number).sort((a, b) => a - b);
    if (!pitches.length) return null;
    const pitch = pitches.includes(wantPitch || 0) ? (wantPitch || 0) : 0;
    const all = HymnFolder.have(num);
    return {
      kind: "folder",
      ref: `${r}:${num}:${pitch}:${use}`,
      from: `${HymnFolder.srcLabel(use)} · ${HymnFolder.roleLabel(r)}`,
      options: all.options, roles: all.roles, role: r, src: use, pitches,
      caps: { tempo: true, pitch: pitches.length > 1, offline: true }
    };
  };

  const provider = (num, opt) => {
    if (!HymnFolder.isLinked()) return null;
    const cur = HymnFolder.pickFor(num);          // 고른 것을 이 곡에 맞춰 정한다
    if (!cur) return null;
    const wantRole = (opt && opt.role) || cur.role;
    const wantSrc  = (opt && opt.src != null) ? opt.src
                   : (wantRole === cur.role ? cur.src : undefined);
    const got = _folderSrc(num, wantRole, opt && opt.pitch, wantSrc);
    if (got) return got;
    // 고른 종류가 폴더에 없다 —
    //  · 1차(strictRole)에는 물러난다. 인터넷 음원이라도 그 종류로 듣는 편이 낫다
    //  · 2차에는 폴더에 있는 다른 종류라도 내놓는다
    if (opt && opt.strictRole) return null;
    return _folderSrc(num, cur.role, opt && opt.pitch, cur.src);
  };
  // 이 곡에 폴더가 가진 것 전부 — 출처까지 갈라서 내놓는다.
  // 종류만 내놓으면 '연합회 반주'와 'SDApraise 찬양'을 따로 고를 수 없다.
  provider.all = (num) =>
    HymnFolder.options(num).map(o => _folderSrc(num, o.role, 0, o.src)).filter(Boolean);
  HymnSource.addProvider(provider);
}
