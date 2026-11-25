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
set -o pipefail   # 「… | sed」 꼴에서도 앞 단계가 실패하면 멈춘다(끝 검토에서 찾음 — 늦게 켜져 칸 띄우기 만들기 실패를 놓쳤다)
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

# WebView 74 대응(v4.33.2, docs/superpowers/specs/2026-11-26-mini-webview74-design.md)
#   ① 화면마다 기기 판별(js/mini-compat.js — 멈춤 감시 바로 뒤)과 보정 CSS(mini-gap · mini-fix — </head> 바로 앞,
#      다른 CSS 보다 뒤)를 붙인다
python3 - "$OUT" <<'PY'
import io, os, re, sys
out = sys.argv[1]
for f in ("index.html", "reader.html", "listen.html", "key.html", "praise.html"):
    p = os.path.join(out, f)
    s = io.open(p, encoding="utf-8").read()
    s = re.sub(r'(<script src="js/boot-guard\.js[^"]*"></script>[^\n]*)', r'\1\n  <script src="js/mini-compat.js"></script>\n  <script src="js/mini-polyfill.js"></script>', s, count=1)
    assert "mini-compat.js" in s, f + " 에 mini-compat.js 를 끼우지 못했습니다(boot-guard 뒤)"
    s = s.replace("</head>", '  <link rel="stylesheet" href="css/mini-gap.css">\n  <link rel="stylesheet" href="css/mini-fix.css">\n</head>', 1)
    assert "mini-fix.css" in s, f + " 에 보정 CSS 를 붙이지 못했습니다"
    io.open(p, "w", encoding="utf-8").write(s)
PY
#   ② 칸 사이 띄우기 대체 CSS 를 원본 CSS 에서 만든다
node scripts/mini-cssfix.mjs "$OUT" | sed 's/^/  /'
#   ③ 스크립트를 크롬 74 문법으로 바꾸고 검사한다(남으면 여기서 멈춘다 — set -e 와 pipefail)
node scripts/mini-transpile.mjs "$OUT" | sed 's/^/  /'

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
