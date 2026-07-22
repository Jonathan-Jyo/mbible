# 개인용 APK 빌드 절차 (Capacitor · Android)

> 성경절암송 + 성경읽기(reader) 웹앱을 개인 안드로이드 폰에 설치하기 위한 APK 빌드 가이드.
> 공개 스토어 배포가 아닌 **개인 사이드로드**용. (저작권 데이터 때문에 스토어 배포는 별도 라이선스 필요)

---

## 0. 현재 상태 (2026-07-22 기준)

| 항목 | 상태 |
|---|---|
| Capacitor 설정 | ✅ `capacitor.config.json` (appId `com.jonathan.biblemem`) |
| `android/` 프로젝트 | ✅ 이미 생성됨 (minSdk 24 · target/compile 36) |
| RECORD_AUDIO 권한 | ✅ 추가됨 — 녹음 기능에 필수 |
| `webDir` = `www` | ✅ 전환됨 (`capacitor.config.json`) — 루트 통째 복사 방지 |
| CDN 라이브러리 로컬화 | ✅ 완료 — JSZip·html2canvas `lib/`로 자체 호스팅 (오프라인 OK) |
| `scripts/sync-www.sh` | ✅ 있음 — 웹 자산만 `www/`로 복사 |
| **전략** | **B. 오프라인 번들** (사용자 선택) |
| `npx cap sync` 실행 | ❌ 아직 안 함 (`android/app/src/main/assets/public` 없음) |
| 빌드 도구(JDK·Android SDK·Studio) | ❌ 이 맥에 아직 없음 → **2절대로 설치 필요** |
| `node_modules` | ⚠️ 불완전 → `npm install` 필요 |

> ✅ 웹 쪽 준비(권한·webDir·CDN 로컬화)는 끝났습니다. **남은 건 빌드 도구 설치 → sync → 빌드**뿐입니다.

---

## 1. 전략 선택 (하나 고르기)

토큰 준비·서명·빌드 명령은 두 전략이 **동일**합니다. 딱 하나, **웹 자산을 어떻게 넣느냐**만 다릅니다.

| | **A. 온라인 래퍼 (추천, 쉬움)** | **B. 오프라인 번들** |
|---|---|---|
| 방식 | APK는 껍데기, 실제 화면은 Netlify 사이트를 로드 | 웹 파일을 APK 안에 포장 |
| 웹 수정 후 | **재빌드 불필요** — Netlify에 push만 하면 폰에 자동 반영 | **매번 재빌드** 필요 |
| 인터넷 | 필요 (앱이 이미 CDN·성경DB 다운로드로 온라인 전제) | 없어도 기본 동작(단, JSZip·html2canvas CDN은 로컬화 필요) |
| `capacitor.config.json` | `server.url` 추가 | `server.url` 없음 |
| 난이도 | ★☆☆ | ★★☆ |

**개인용·항상 온라인이면 A를 추천**합니다. 아래는 공통 준비 → 전략별 자산 단계 → 서명·빌드 순서입니다.

---

## 2. 공통 준비 (한 번만)

### 2-1. JDK 21 설치 (Temurin)
```bash
brew install --cask temurin@21
java -version   # 21.x 확인
```
> Android Studio를 쓰면 내장 JDK(JBR)가 있지만, 커맨드라인 `./gradlew` 빌드에는 별도 JDK가 편합니다.

### 2-2. Android SDK 설치 (Android Studio 권장)
```bash
brew install --cask android-studio
```
- Android Studio 최초 실행 → **SDK Manager**에서 다음 설치:
  - **Android SDK Platform 36**
  - **Android SDK Build-Tools** (최신)
  - **Android SDK Command-line Tools (latest)**
  - **Android SDK Platform-Tools** (`adb` 포함)
- 환경변수 등록 (`~/.zshrc`에 추가 후 `source ~/.zshrc`):
```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

### 2-3. Capacitor CLI + 의존성 복구
```bash
cd "/Users/ipentech/Documents/@구글공유(조영주)/조나단 코딩/성경절암송"
npm install
npx cap --version   # 동작 확인
```

---

## 3. 웹 자산 단계 (전략별)

### 공통: `webDir`를 `www`로 (루트 통째 복사 방지) — ✅ 완료
`capacitor.config.json`은 이미 `"webDir": "www"`로 되어 있습니다(전략 B). 참고용 형태:

**전략 A (온라인 래퍼):**
```json
{
  "appId": "com.jonathan.biblemem",
  "appName": "성경절암송",
  "webDir": "www",
  "server": { "url": "https://<내-사이트>.netlify.app", "androidScheme": "https" }
}
```
> `<내-사이트>`는 실제 Netlify 도메인으로 교체. `server.url`이 있으면 WebView가 그 주소를 로드하므로
> `www/`엔 최소 파일만 있어도 됩니다(빈 `index.html` 하나면 충분).

**전략 B (오프라인 번들):**
```json
{
  "appId": "com.jonathan.biblemem",
  "appName": "성경절암송",
  "webDir": "www"
}
```

### `www/` 채우기 — 스크립트 사용
`scripts/sync-www.sh`가 앱 실행에 필요한 파일만 `www/`로 복사합니다 (node_modules·android·.git 제외).
```bash
bash scripts/sync-www.sh
```
> 전략 A는 사실상 껍데기라 `www/`가 최소여도 되지만, 스크립트를 그대로 써도 무방합니다.
> Netlify는 계속 **저장소 루트**를 배포하므로 `www/` 추가는 웹 배포에 영향 없습니다. (`www/`는 `.gitignore` 처리)

### (전략 B) CDN 라이브러리 로컬화 — ✅ 이미 완료됨
오프라인에서 백업(.zip)·악보(.cmp)·이미지 카드가 동작하도록 CDN을 로컬로 바꿔 뒀습니다.
- `lib/jszip.min.js` (3.10.1), `lib/html2canvas.min.js` (1.4.1) 자체 호스팅
- `index.html`·`reader.html`의 참조를 `lib/…`로 교체 (CDN 참조 0)
> 추가 작업 필요 없음. (성경 DB `.bdb/.cdb`는 원래대로 런타임 IndexedDB 로드)

---

## 4. 안드로이드에 반영 (sync)
```bash
npx cap sync android
```
- 웹 자산을 `android/app/src/main/assets/public`로 복사하고 플러그인을 갱신합니다.
- `webDir`가 `www`인지 다시 확인 (루트면 안 됨).

---

## 5. APK 서명

### 5-A. 디버그 APK (가장 쉬움 · 첫 시도 추천)
별도 키 없이 디버그 키로 자동 서명됩니다.
```bash
cd android
./gradlew assembleDebug
# 산출물: android/app/build/outputs/apk/debug/app-debug.apk
```
> 개인 설치엔 이걸로 충분합니다. 단, 디버그 키는 `~/.android/debug.keystore`에 종속돼
> 기기 초기화/맥 변경 시 "같은 앱 업데이트"가 안 될 수 있습니다. 오래 쓸 거면 5-B 권장.

### 5-B. 릴리스 keystore (오래 쓸 개인 앱 · 업데이트 일관성)
1) 키스토어 생성 (한 번만, **비밀번호·파일 안전 보관**):
```bash
keytool -genkey -v -keystore ~/keys/biblemem-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias biblemem
```
2) `android/keystore.properties` 생성 (이 파일은 **깃에 올리지 말 것**, `.gitignore` 처리):
```
storeFile=/Users/ipentech/keys/biblemem-release.jks
storePassword=***
keyAlias=biblemem
keyPassword=***
```
3) `android/app/build.gradle`의 `android { }` 안에 서명 설정 추가:
```gradle
    signingConfigs {
        release {
            def props = new Properties()
            def f = rootProject.file("keystore.properties")
            if (f.exists()) { f.withInputStream { props.load(it) } }
            storeFile file(props['storeFile'])
            storePassword props['storePassword']
            keyAlias props['keyAlias']
            keyPassword props['keyPassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release   // ← 이 줄 추가
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
```
4) 빌드:
```bash
cd android && ./gradlew assembleRelease
# 산출물: android/app/build/outputs/apk/release/app-release.apk
```

---

## 6. 폰에 설치
- **USB(adb):** 개발자 옵션·USB 디버깅 켠 뒤
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```
- **파일 전송:** APK를 카톡/드라이브/USB로 폰에 옮겨 열고 "출처를 알 수 없는 앱 설치" 허용.

---

## 7. 릴리스마다 반복 체크리스트

**전략 A (온라인):** 웹은 그냥 `git push` → Netlify 자동 배포. APK 재빌드는 앱 아이콘/이름/권한 등 **네이티브가 바뀔 때만**.

**전략 B (오프라인):**
1. `android/app/build.gradle`의 `versionCode` +1, `versionName` 갱신
2. `bash scripts/sync-www.sh`
3. `npx cap sync android`
4. `cd android && ./gradlew assembleRelease`
5. 폰에 재설치

---

## 8. 트러블슈팅

- **녹음이 안 됨(마이크 무반응):** RECORD_AUDIO 권한은 추가돼 있음. 안드로이드 6+는 **런타임 권한 요청**이 필요.
  Capacitor WebView가 `getUserMedia` 권한 요청을 네이티브 권한과 연결해 주지만, 기종에 따라
  최초 1회 권한 팝업이 뜨는지 확인. 안 뜨면 `@capacitor/…` 권한 처리나 `onPermissionRequest` 핸들러 검토.
- **파일 다운로드/공유(백업 zip, 카드 이미지):** WebView의 `a[download]`가 막힐 수 있음.
  `navigator.share`(Web Share) 경로는 대개 동작. 다운로드가 필요하면 `@capacitor/filesystem`+공유 시트로 대체 검토.
- **서비스워커(sw.js):** 전략 A(https)에선 정상. 전략 B(`capacitor://localhost`)에선 등록이 안 될 수 있으나
  이미 `try/catch`라 앱 동작엔 지장 없음(오프라인 캐시만 미적용).
- **`cap sync`가 거대해지거나 느림:** `webDir`가 아직 `"."`인지 확인 → `www`로.
- **Gradle JDK 오류:** `java -version`이 21인지, Android Studio의 Gradle JDK 설정 확인.
- **성경 DB(.bdb/.cdb):** 앱에 포장하지 않고 기존처럼 런타임에 IndexedDB로 불러옴(용량·저작권 이유). APK엔 코드만.

---

## 9. 다음에 할 일 (제안 순서)
1. 전략 A/B 결정
2. JDK 21 + Android Studio(SDK 36) 설치
3. `npm install` → `capacitor.config.json` `webDir`/`server` 수정 → `sync-www.sh` → `cap sync`
4. **디버그 APK**로 첫 설치·동작 확인 (특히 녹음 권한)
5. 문제 없으면 릴리스 keystore로 정식 개인 APK
