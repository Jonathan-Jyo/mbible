#!/usr/bin/env bash
# ============================================================================
# 웹 자산을 www/ 로 복사 (Capacitor webDir 용)
# · node_modules / android / .git / 참고 등 불필요한 것 제외 → APK 비대화 방지
# · Netlify는 계속 저장소 루트를 배포하므로 웹 배포엔 영향 없음
# 사용: bash scripts/sync-www.sh
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf www
mkdir -p www

# 앱 실행에 필요한 최상위 파일
for f in index.html reader.html manifest.json sw.js favicon.png; do
  [ -f "$f" ] && cp "$f" www/
done

# 필요한 디렉터리 통째 복사
#  · data = 기본 탑재 성경(한영중일인) JSON (필수)
#  · audio = 기본 음성 mp3 (137MB) — 오프라인 기본음성/이어듣기용. 용량 크면 INCLUDE_AUDIO=0 로 제외
for d in css js lib images data; do
  [ -d "$d" ] && cp -R "$d" www/
done
if [ "${INCLUDE_AUDIO:-1}" = "1" ] && [ -d audio ]; then
  cp -R audio www/
fi

echo "✓ www/ 준비 완료 ($(du -sh www | cut -f1))"
echo "  다음: npx cap sync android"
