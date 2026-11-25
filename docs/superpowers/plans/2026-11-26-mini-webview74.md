# 소형폰 판(mini) WebView 74 대응 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** mini 판(4.33.2)의 스크립트를 빌드 때 크롬 74 문법으로 바꾸고, 74 판이 모르는 CSS 를 mini 에만 보정해 S45 Pro 에서 네 화면이 열리게 한다.

**Architecture:** `scripts/build-mini.sh` 가 www-light 를 www-mini 로 복사한 뒤 `scripts/mini-transpile.mjs` 를 부른다. 이 스크립트는 esbuild `transform`(번들 없이, 파일마다)으로 `js/*.js` · `lib/sqljs/sql-wasm.js` · HTML 안 `<script>` 글을 `chrome74` 로 바꾸고, 바꾼 결과를 다시 검사해 새 문법이 남았으면 실패한다. `css/mini-fix.css` 는 mini 의 화면에만 `<link>` 로 붙는다.

**Tech Stack:** Node 26(내장 `node:test`), esbuild(devDependency), bash, Capacitor 8 안드로이드 빌드

**Spec:** `docs/superpowers/specs/2026-11-26-mini-webview74-design.md`

## Global Constraints
- 대상 문법: **`chrome74`** — `?.` · `??` · `??=` `||=` `&&=` 가 남으면 안 된다
- 원본(저장소의 js/·*.html)은 바꾸지 않는다 — 변환은 www-mini 안에서만
- 번들하지 않는다(`bundle: false`) — 전역 이름·스크립트 차례 그대로
- `<script src="…">`(내용 없는 것)는 손대지 않는다. `type` 이 없거나 `text/javascript`·`module` 이 아닌 일반 스크립트만
- 판: mini **4.33.2** (js/version.js 의 `mini`), versionCode 150. 정식 5.33.2 · light 3.33.2 그대로
- 화면 글은 한국어, 코드 주석도 한국어(이 저장소 관례)

## Review Focus
1. HTML 안 스크립트에 `</script>` 가 문자열로 들어 있는 경우 — 잘못 잘라 화면이 깨지지 않아야 한다 → Task 1 시험 `inline-script-with-closing-tag-string`
2. 스크립트 앞뒤 공백·주석이 바뀌어 `boot-guard` 의 줄 번호가 달라지는 것은 괜찮다(기능 동일) — 대신 **바꾼 스크립트가 같은 값을 돌려주는지** 시험 → Task 1 `transpiled-behaves-the-same`
3. esbuild 가 바꾸지 못하는 문법(예: 최상위 await)이 있으면 조용히 넘어가지 말고 빌드가 멈춰야 한다 → Task 1 `unlowerable-syntax-fails`
4. 이미 옛 문법인 파일(boot-guard.js·diag.html)은 바뀌어도 동작이 같아야 한다 → Task 3 에뮬레이터 시험에서 멈춤 감시·진단 화면 다시 확인
5. 352px 폭에서 가로 넘침이 없어야 한다(보정 CSS 가 여백을 더하므로) → Task 2 시험 `no-horizontal-overflow-352`

---

### Task 1: 변환기 `scripts/mini-transpile.mjs` + 검사

**Files:**
- Create: `scripts/mini-transpile.mjs`
- Create: `scripts/mini-transpile.test.mjs`
- Modify: `package.json` (devDependencies 에 `esbuild`, scripts 에 `"test:mini": "node --test scripts/mini-transpile.test.mjs"`)

**Interfaces:**
- Produces:
  - `export async function lowerJs(code: string, name: string): Promise<string>` — esbuild transform(`loader: "js"`, `target: "chrome74"`, `charset: "utf8"`, `legalComments: "inline"`). 낮출 수 없는 문법이면 throw(메시지에 name)
  - `export async function lowerHtml(html: string, name: string): Promise<string>` — 내용이 있는 일반 `<script>` 만 `lowerJs` 로 바꿔 끼운다
  - `export async function isClean(code: string): Promise<boolean>` — `transform(code, esnext) === transform(code, chrome74)` 이면 true(더 낮출 것이 없다)
  - `export async function transpileDir(dir: string): Promise<{ files: number, changed: number }>` — `dir/js/*.js`, `dir/lib/sqljs/sql-wasm.js`, `dir/*.html` 를 바꾸고, 다 바꾼 뒤 같은 파일들을 `isClean` 으로 검사해 하나라도 false 면 throw(파일 이름 목록)
  - 명령줄: `node scripts/mini-transpile.mjs <dir>` → 한 줄 요약 출력, 실패하면 exit 1

- [ ] **Step 1: 시험 쓰기** — `scripts/mini-transpile.test.mjs` (node:test)
  - `lowers-optional-chaining`: `lowerJs("var a={};var r=a?.b??1;")` 결과에 `?.`·`??` 없음
  - `transpiled-behaves-the-same`: `new Function(out + ";return r")()` === `1`, 그리고 `a={b:{c:5}}; r=a?.b?.c ?? 0; x=null; x ??= 7;` → `[5,7]`
  - `inline-script-with-closing-tag-string`: `<script>var s="<\/script>";var o={};var v=o?.k;</script><p>끝</p>` → 결과에 `<p>끝</p>` 그대로, `?.` 없음
  - `leaves-src-scripts-alone`: `<script src="a.js"></script>` 그대로
  - `isClean`: `"var a=1;"` → true, `"a?.b"` → false
  - `unlowerable-syntax-fails`: `lowerJs("await 1;", "x.js")` 가 throw 하고 메시지에 `x.js`
- [ ] **Step 2: 실패 확인** — `npm run test:mini` → 모듈 없음으로 FAIL
- [ ] **Step 3: `npm i -D esbuild` 후 위 다섯 함수 구현** — HTML 의 스크립트는 정규식 `/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi` 로 찾고, 여는 꼬리표에 `src=` 가 있거나 `type` 이 일반 JS 가 아니면 건너뛴다(JS 문자열 안의 `</script>` 는 HTML 에서 원래 쓸 수 없으므로 원본은 `<\/script>` 꼴이다)
- [ ] **Step 4: 통과 확인** — `npm run test:mini` → 6 pass
- [ ] **Step 5: 실제 자산에 돌려 보기** — `bash scripts/build-light.sh && rm -rf /tmp/m && cp -R www-light /tmp/m && node scripts/mini-transpile.mjs /tmp/m` → 「파일 N개 · 바뀜 M개 · 검사 통과」
- [ ] **Step 6: Commit** — `git add scripts/mini-transpile.mjs scripts/mini-transpile.test.mjs package.json package-lock.json && git commit -m "feat: mini 변환기 — 크롬 74 문법으로(esbuild)"`

### Task 2: 보정 CSS `css/mini-fix.css`

**Files:**
- Create: `css/mini-fix.css`
- Modify: `scripts/build-mini.sh` (mini 의 index·reader·listen·key·praise.html `</head>` 앞에 `<link rel="stylesheet" href="css/mini-fix.css">`)

**Interfaces:**
- Consumes: 없음(CSS)
- Produces: mini 화면에만 붙는 보정 규칙

- [ ] **Step 1: 74 판에서 깨지는 곳 목록** — 앞선 훑기(작업기록 「11-23 옛 WebView 훑기」): flex `gap` 쓰는 규칙(style.css·각 화면 `<style>`), `aspect-ratio` 11곳(index·pray·praise·listen·reader·share·style.css 의 달력 칸·요일 동그라미, praise `.yt-box`). 네 화면+첫화면에 쓰이는 것만 고른다
- [ ] **Step 2: 보정 규칙 쓰기** — `@supports not (aspect-ratio: 1)` 안에 비율 대체(달력 칸 `min-height`, `.yt-box` 는 `height:0; padding-top:56.25%`), flex gap 은 `@supports` 로 가를 수 없으므로 mini 에만 붙는 파일 안에서 자주 쓰는 줄·단추 묶음에 `> * + *` 여백(가로 줄은 `margin-left`, 감싸는 줄은 `margin: 0 6px 6px 0`)
- [ ] **Step 3: 시험** — 브라우저 352×700 에서 mini 의 다섯 화면: `no-horizontal-overflow-352`(document.documentElement.scrollWidth ≤ 352) · 단추 묶음 사이 여백 > 0(최신 크롬에서는 gap 과 margin 이 겹쳐 조금 넓어질 수 있다 — 넘치지만 않으면 된다) · 사진
- [ ] **Step 4: Commit** — `git add css/mini-fix.css scripts/build-mini.sh && git commit -m "feat: mini 보정 CSS — gap·aspect-ratio 대체"`

### Task 3: mini 빌드에 잇고 판 4.33.2, 시험·기록

**Files:**
- Modify: `scripts/build-mini.sh` (www-mini 를 만든 뒤 `node scripts/mini-transpile.mjs www-mini`, 실패하면 빌드 멈춤)
- Modify: `js/version.js` (`mini: "4.33.2"`, `code: 150`)
- Modify: `CHANGELOG.md`, `docs/작업기록-2026-10-05~06.md`, `docs/superpowers/specs/2026-11-26-mini-webview74-design.md`(끝에 「만든 것」)

**Interfaces:**
- Consumes: Task 1 의 명령줄 `node scripts/mini-transpile.mjs <dir>`, Task 2 의 `css/mini-fix.css`

- [ ] **Step 1: build-mini.sh 에 변환 단계** — `cp -R www-light "$OUT"` 다음, edition 파일을 쓴 뒤 `node scripts/mini-transpile.mjs "$OUT" | sed 's/^/  /'`
- [ ] **Step 2: 판 올리기** — version.js `mini: "4.33.2"`, `code: 150`
- [ ] **Step 3: 세 판 빌드** — `bash scripts/build-apks.sh` → 세 APK, mini 줄에 `4.33.2`. 이어서 `unzip -p 산출물APK/항상예수께로_mini-4.33.2.apk assets/public/reader.html | grep -c "?\."` → 0
- [ ] **Step 4: 에뮬레이터** — mini 디버그 판 설치 → 첫화면 · 요한복음 1장 · 말씀듣기 · 암송 · 찬양이 열리고 콘솔 오류 없음, 판 v4.33.2, 진단 화면 「조건 모두 갖춤」
- [ ] **Step 5: 기록·커밋·푸시** — CHANGELOG(v4.33.2), 작업기록, 설계 문서 「만든 것」 → `git commit -m "fix: mini 4.33.2 — WebView 74 에서 돌게(빌드 때 변환·보정 CSS)"` → 푸시(`gh auth switch --user Jonathan-Jyo` → push → `Jotimjang`)
