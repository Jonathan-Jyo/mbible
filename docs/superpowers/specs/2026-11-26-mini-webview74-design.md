# 소형폰 판(mini) — WebView 74 에서 돌게 (설계, 2026-11-26)

## 왜
- 대표의 S45 Pro(안드로이드 10 · 화면 352×783 · 메모리 2GB · 구글 WebView/Chrome 없음)는 **제조사 WebView 74 판**을 쓴다(진단 화면 결과).
- 74 판은 `?.` · `??` · `??=`(과 `||=` `&&=`)를 모른다 → 그 문법이 든 스크립트 파일을 통째로 버린다 → 성경읽기가 「불러오는 중」에서 멈춘다.
- 이 폰에서 쓸 것: **성경읽기 · 말씀듣기 · 말씀암송 · 찬양듣기**(mini 판이 담는 화면과 같다).

## 목표 · 하지 않을 것
- 목표: mini 판의 네 화면이 WebView 74 에서 열리고 쓸 만한 모양으로 보인다.
- 하지 않는다: 원본 코드의 문법을 바꾸지 않는다(정식·가벼운 판은 지금 그대로). mini 에 담지 않은 화면(기도·나눔·회고)은 다루지 않는다.
- 실패로 볼 것: 변환이 원본과 다르게 동작해 mini 에서만 기능이 틀어지는 것 — 그래서 변환 뒤 검사와 화면 시험을 둔다.

## 고른 길 — 가. 빌드 때 자동 변환 (대표 결정)
| 길 | 내용 | 고르지 않은 까닭 |
|---|---|---|
| **가. 빌드 때 변환** | mini 빌드만 esbuild 로 크롬 74 문법으로 바꾼다 | — (고름: 원본 그대로, 앞으로 고친 것도 저절로) |
| 나. 손으로 풀어 쓰기 | 원본 약 100곳 + sql.js 옛 판 | 세 판 모두 앞으로 문법 제약을 져야 한다 |
| 다. 폰 WebView 바꾸기 | 개발자 옵션 › WebView 구현 | 제조사가 허락한 것만 — 될지 모른다(대표가 따로 확인) |

## 어떻게
1. **변환 도구**: `esbuild`(개발용, package.json devDependencies). 대상 `chrome74`. 뭉치지 않고(번들 없이) 파일마다 문법만 바꾼다 — 전역 이름·스크립트 차례가 그대로 남는다.
2. **변환 범위(www-mini 안)**: `js/*.js` · `lib/sqljs/sql-wasm.js` · 각 HTML 의 `<script>` 안 글(외부 파일을 부르는 `<script src>` 는 그대로). `boot-guard.js`·`diag.html` 은 이미 옛 문법이라 걸러도 그대로.
3. **검사**: 변환한 뒤 www-mini 의 스크립트를 크롬 74 문법 기준으로 다시 읽어(esbuild 로 `?.`·`??`·논리 대입이 남았는지) 남았으면 빌드를 멈춘다.
4. **모양 보정(mini 만)**: `css/mini-fix.css` — 74 판이 모르는 것의 대체
   - flex `gap`(84+) → 자식 사이 여백으로(자주 쓰는 줄·단추 묶음부터)
   - `aspect-ratio`(88+) → 높이 지정·`padding-top` 비율 상자(달력 칸·요일 동그라미·유튜브 창)
   - 그 밖(`min()/max()`·`:has`·`color-mix`·`accent-color`)은 모양만 — 보고 필요한 것만
   - mini 의 네 화면 + 첫화면에 `<link>` 로 붙인다(build-mini.sh)
5. **시험**: 브라우저에서 352px 폭으로 네 화면 사진 · 에뮬레이터(최신 WebView)에서 mini 동작 · 가능하면 크롬 74 에 가까운 환경(없으면 [확인 못 함]) → 최종은 대표가 S45 Pro 에서.
6. **판**: mini **4.33.2** 부터(이번이 고침). 정식·가벼운 판은 화면 변화가 없으므로 그대로.

## 빌더에게 맡기는 것
- esbuild 를 부르는 작은 node 스크립트(`scripts/mini-transpile.mjs`)의 짜임, HTML 안 스크립트를 찾는 방법
- mini-fix.css 에서 어떤 규칙을 대체할지(352px 화면을 보며)

## 만든 것 (v4.33.2, 2026-11-26)
- `scripts/mini-transpile.mjs`(+시험 6) — esbuild `chrome74`, 번들 없이. js/*.js · 맨 위 *.js(sw.js — 계획에 없던 것을 더함) · lib/sqljs/sql-wasm.js · *.html 안 일반 `<script>`. 검사 = esnext 로 다시 찍은 것과 chrome74 로 낮춘 것이 같은가
- `scripts/mini-cssfix.mjs`(+시험 7) — flex gap 을 자식 사이 여백으로(가로 margin-left · 세로 margin-top · 감싸는 줄 margin-right/bottom), grid 는 그대로, @media/@supports 안은 그 안에. `html.no-flex-gap` 아래에만 → css/mini-gap.css(빌드가 만든다, 198 규칙)
- `js/mini-compat.js` — 그 기기가 flex gap·aspect-ratio 를 모를 때만 `html.no-flex-gap` · `html.no-aspect-ratio`(설계의 「mini 에만 붙는 파일」 대신: 최신 기기에서 mini 를 열어도 여백이 두 번 붙지 않게)
- `css/mini-fix.css` — aspect-ratio 대체(달력 칸 40px · 장 숫자 칸 54px · 요일 동그라미 40px · 유튜브 창 padding-top 56.25%)
- `scripts/build-mini.sh` — 판별 스크립트·보정 CSS 끼우기 → gap CSS 만들기 → 변환·검사(실패하면 멈춤)
- 시험: `npm run test:mini` 13 통과 · mini APK 안 화면 5·app.js·reader-listen.js·sql-wasm.js 검사 「깨끗」 · 브라우저 352px(74 판 흉내) 다섯 화면 넘침 없음 · 에뮬레이터 다섯 화면 오류 없음
- 남은 것: 글자와 요소가 섞인 flex 줄은 여백이 안 들어간다(모양만) · **S45 Pro 실물 확인**
