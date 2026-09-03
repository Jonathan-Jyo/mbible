#!/usr/bin/env bash
# ============================================================================
# build-light.sh — 항상예수께로_light 용 웹 자산을 만든다
# ----------------------------------------------------------------------------
# 느려서 노는 구형 태블릿을 "말씀 읽고 찬미가 부르는 도구"로 쓰려고 만든 판.
# 옛 버전을 되살리는 것이 아니라, 지금 코드에서 짐만 덜어낸다.
# 코드는 한 벌뿐이므로 앞으로 고치는 것이 이쪽에도 그대로 반영된다.
#
# 덜어내는 것 —
#   audio/   137MB  기본 음성 (성경 읽기·암송에 필수가 아니다)
#   images/   13MB  암송 그림연상
#   성경 역본 2개    새번역(ko_new) · 화합본 번체(zh_trad)
#
# 담는 것 — 성경읽기 · 성경암송 · 찬미가(매일찬양 안에 있다)
# ============================================================================
set -e
cd "$(dirname "$0")/.."
OUT="www-light"

echo "▶ 가벼운 판 만들기"
rm -rf "$OUT"; mkdir -p "$OUT"

# ── 화면·코드 ────────────────────────────────────────────────────────────
for f in index.html key.html reader.html praise.html manifest.json sw.js favicon.png favicon-32.png; do
  [ -e "$f" ] && cp "$f" "$OUT/"
done
cp -R js css lib icons "$OUT/" 2>/dev/null || true   # icons: 상단 칩 로고

# 이 판임을 알리는 표시 한 줄 — 허브가 이것을 보고 기도·나눔·회고를 감춘다.
# 화면 파일을 따로 만들지 않는 까닭: 두 벌이 되면 반드시 어긋난다.
cat > "$OUT/js/edition-light.js" <<'EOF'
// 가벼운 판임을 알린다. index.html 이 이 값을 보고 담기지 않은 앱을 감춘다.
window.LIGHT_EDITION = true;
window.LIGHT_VERSION = "v3.8";
EOF
# 허브가 가장 먼저 읽도록 맨 앞에 끼운다
python3 - "$OUT/index.html" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
tag = '<script src="js/edition-light.js"></script>'
if tag not in s:
    s = s.replace("</head>", "  " + tag + "\n</head>", 1)
io.open(p, "w", encoding="utf-8").write(s)
PY

# ── 성경 본문 — 역본 둘을 덜어낸다 ───────────────────────────────────────
mkdir -p "$OUT/data/bible-db"
python3 - <<'PY'
import json, os, glob
DROP = {"ko_new", "zh_trad"}          # 새번역 · 화합본(번체)
src, dst = "data/bible-db", "www-light/data/bible-db"
kept = dropped = 0
for f in sorted(glob.glob(os.path.join(src, "*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    if isinstance(d.get("versions"), list):
        d["versions"] = [v for v in d["versions"] if v not in DROP]
    for verse in d.get("verses", {}).values():
        for v in list(verse):
            if v in DROP:
                del verse[v]; dropped += 1
    # 사람이 읽을 일이 없는 자료다 — 빈칸을 빼 파일을 줄인다
    json.dump(d, open(os.path.join(dst, os.path.basename(f)), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    kept += 1
print(f"  성경 {kept}권 · 역본 칸 {dropped:,}개 덜어냄")
PY

echo "  ── 무게 ──"
du -sh "$OUT" | sed 's/^/    합계 /'
for d in data js lib css; do [ -d "$OUT/$d" ] && du -sh "$OUT/$d" | sed 's/^/    /'; done
echo "▶ 다음: npx cap sync android && cd android && ./gradlew assembleLightRelease"
