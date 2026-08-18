#!/usr/bin/env bash
# ============================================================================
# egw_relay — 받는 대로 한 권씩 굳혀 공유 폴더에 올린다
# ----------------------------------------------------------------------------
# 형제앱이 청한 것: "다 끝나고 한꺼번에 말고, 받으시는 대로 한 권씩 올려
# 주십시오. 그래야 첫 권부터 대조 수치를 내고 편집기를 맞춰 볼 수 있습니다."
#
# 다 받은 책(complete)만 굳힌다 — 받다 만 것을 올리면 상대가 그것을 온전한
# 자료로 알고 수치를 낸다. 올릴 때는 egw_share.py 로만 — 덮지 않는다.
# ============================================================================
set -u
RAW="${1:?날것폴더}"
OUT="${2:?출력폴더}"
SHARED="${3:?공유폴더}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$RAW/.complete"

while :; do
  mkdir -p "$STAGE"
  # 다 받은 것만 골라 둔다
  python3 - "$RAW" "$STAGE" <<'PY'
import json, os, shutil, sys
raw, stage = sys.argv[1], sys.argv[2]
for f in os.listdir(raw):
    if not f.endswith(".json") or f in ("booklist.json", "booknr.json"):
        continue
    try:
        if not json.load(open(os.path.join(raw, f))).get("complete"):
            continue
    except Exception:
        continue
    dst = os.path.join(stage, f)
    if not os.path.exists(dst) or os.path.getmtime(os.path.join(raw, f)) > os.path.getmtime(dst):
        shutil.copy2(os.path.join(raw, f), dst)
PY
  if ls "$STAGE"/*.json >/dev/null 2>&1; then
    python3 "$HERE/scripts/egw_fetch.py" "$STAGE" --build "$OUT" >/dev/null 2>&1
    python3 "$HERE/scripts/egw_share.py" "$OUT" "$SHARED" | sed "s/^/[$(date +%H:%M)] /"
  fi
  sleep 600            # 10분마다. 자주 볼 까닭이 없다
done
