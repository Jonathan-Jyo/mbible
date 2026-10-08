#!/usr/bin/env bash
# ============================================================================
# build-apks.sh — 두 판을 한 번에 뽑는다
# ----------------------------------------------------------------------------
#   full   항상예수께로        모든 기능 (약 167MB)
#   light  항상예수께로_light  읽기·암송·찬미가 (약 34MB, 구형 태블릿용)
#
# 코드는 한 벌이다. 갈래(flavor)로 담는 자산과 앱 이름만 나눈다 —
# 옛 버전을 따로 보관하지 않아도 되는 까닭이 이것이다.
#
#   bash scripts/build-apks.sh          두 판 다
#   bash scripts/build-apks.sh light    가벼운 판만
#
# 윈도우에서는 Git Bash 에서 돌린다(ANDROID_HOME 을 SDK 자리로). 저장소 경로에 한글이 있으면
# 안드로이드 빌드 도구가 막으니 C:/dev/claude_code/biblemem 처럼 영문 경로에 둔다(docs/윈도우로-옮기기.md)
#
# 결과는 산출물APK/ 에 「이름-판번호.apk」로 모인다.
# ============================================================================
set -e
cd "$(dirname "$0")/.."
WHICH="${1:-both}"
A=android/app/src

echo "▶ 웹 자산 준비"
bash scripts/sync-www.sh >/dev/null
npx cap sync android >/dev/null 2>&1

# cap sync 는 늘 main 에 쓴다. 갈래별 자리로 옮긴다 —
# main 에 두면 어느 갈래에나 들어가 light 에도 audio 137MB 가 딸려 간다.
rm -rf "$A/full/assets"; mkdir -p "$A/full/assets"
mv "$A/main/assets/public" "$A/full/assets/public"
echo "  full  $(du -sh "$A/full/assets/public" | cut -f1)"

if [ "$WHICH" != "full" ]; then
  bash scripts/build-light.sh | grep -E "성경|합계" | sed 's/^/  /'
  rm -rf "$A/light/assets"; mkdir -p "$A/light/assets"
  cp -R www-light "$A/light/assets/public"
  echo "  light $(du -sh "$A/light/assets/public" | cut -f1)"
fi

echo "▶ 빌드"
cd android
case "$WHICH" in
  full)  ./gradlew assembleFullRelease  -q ;;
  light) ./gradlew assembleLightRelease -q ;;
  *)     ./gradlew assembleFullRelease assembleLightRelease -q ;;
esac
cd ..

echo "▶ 결과 → 산출물APK/"
# 빌드한 APK 는 늘 이 폴더에 이름·판 번호를 붙여 모은다 (깃에는 넣지 않는다 — .gitignore)
#   항상예수께로-5.9.0.apk · 항상예수께로_light-3.9.0.apk
# 판이 다르면 옛것은 그대로 남는다(되돌릴 때 쓴다). 같은 판을 다시 빌드하면 덮어쓴다.
OUT_DIR="산출물APK"
mkdir -p "$OUT_DIR"
# 안드로이드 SDK 위치 — 윈도우(Git Bash)·리눅스는 ANDROID_HOME(또는 ANDROID_SDK_ROOT), 없으면 맥의 기본 자리
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
case "$WHICH" in
  full)  FLAVORS="full" ;;
  light) FLAVORS="light" ;;
  *)     FLAVORS="full light" ;;
esac
for fl in $FLAVORS; do
  apk="android/app/build/outputs/apk/$fl/release/app-$fl-release.apk"
  [ -f "$apk" ] || { echo "  ⚠ $fl APK 가 없습니다: $apk"; continue; }
  info=$("$BT/aapt2" dump badging "$apk" 2>/dev/null | head -1)
  name=$(echo "$info" | grep -o "name='[^']*'" | head -1 | cut -d"'" -f2)
  ver=$(echo "$info" | grep -o "versionName='[^']*'" | cut -d"'" -f2)
  label=$([ "$fl" = "light" ] && echo "항상예수께로_light" || echo "항상예수께로")
  dest="$OUT_DIR/$label-$ver.apk"
  cp "$apk" "$dest"
  printf "  %-34s %-8s %s  → %s\n" "$name" "$ver" "$(du -h "$dest" | cut -f1)" "$dest"
done
