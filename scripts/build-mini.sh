#!/usr/bin/env bash
# ============================================================================
# build-mini.sh — 항상예수께로_mini(소형폰 판, v4.33.1~) 용 웹 자산을 만든다
# ----------------------------------------------------------------------------
# 옛 WebView 를 쓰는 작은 폰(S45 Pro · 안드로이드 10 · 구글 WebView/Chrome 없음)에서
# 성경읽기 · 말씀듣기 · 말씀암송 · 찬양듣기 넷을 쓰려고 만든 판(2026-11-26 대표 지시).
#
# 지금(4.33.1)은 진단판이다 — 담는 화면은 가벼운 판과 같고, 다른 것은 셋:
#   · 이 판임을 알리는 표시(window.MINI_EDITION) — 판 번호를 4.x 로 보인다
#   · WebView 판 검사로 막지 않는다(capacitor.config.json 을 이 판 것으로 덮는다) — 그 기기에서 무엇이 되고
#     무엇이 안 되는지 보려고. 대신 화면마다 멈춤 감시(js/boot-guard.js)가 까닭을 보이고, diag.html 로 간다
#   · 결과 폴더 www-mini → android/app/src/mini/assets/public
# ============================================================================
set -e
cd "$(dirname "$0")/.."
OUT="www-mini"

MINI_VER=$(sed -n 's/.*mini: *"\([0-9.]*\)".*/\1/p' js/version.js | head -1)
[ -n "$MINI_VER" ] || { echo "js/version.js 에서 mini 판 번호를 못 읽었습니다"; exit 1; }

echo "▶ 소형폰 판(mini $MINI_VER) 만들기 — 가벼운 판에서 출발"
bash scripts/build-light.sh >/dev/null
rm -rf "$OUT"; cp -R www-light "$OUT"

cat > "$OUT/js/edition-light.js" <<JS
// 소형폰 판(mini)임을 알린다 — 가벼운 판과 같은 화면을 담고(LIGHT_EDITION), 판 번호만 4.x 로 보인다
window.LIGHT_EDITION = true;
window.MINI_EDITION = true;
window.LIGHT_VERSION = "v$MINI_VER";
JS

# 이 판의 Capacitor 설정 — WebView 판 검사를 하지 않는다(55 는 Capacitor 가 받는 가장 낮은 값). 오류 화면도 두지 않는다
python3 - <<'PY'
import json
c = json.load(open("capacitor.config.json", encoding="utf-8"))
c.setdefault("android", {})["minWebViewVersion"] = 55
if "server" in c:
    c["server"].pop("errorPath", None)
    if not c["server"]: c.pop("server")
json.dump(c, open("www-mini/.capacitor.config.mini.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
echo "  mini $(du -sh "$OUT" | cut -f1)"
