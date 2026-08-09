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

echo "▶ 결과"
BT=$(ls -d ~/Library/Android/sdk/build-tools/* | sort -V | tail -1)
for apk in $(find android/app/build/outputs/apk -name "*.apk" -newermt "-10 minutes" 2>/dev/null | sort); do
  info=$("$BT/aapt2" dump badging "$apk" 2>/dev/null | head -1)
  name=$(echo "$info" | grep -o "name='[^']*'" | head -1 | cut -d"'" -f2)
  ver=$(echo "$info" | grep -o "versionName='[^']*'" | cut -d"'" -f2)
  printf "  %-34s %-8s %s\n" "$name" "$ver" "$(du -h "$apk" | cut -f1)"
done
