#!/usr/bin/env python3
# ============================================================================
# egw_share — 공유 폴더에 .wdb 를 **덮어쓰지 않고** 올린다
# ----------------------------------------------------------------------------
# 왜 생겼나 —
#   2026-08-18, 내가 `cp ~/Desktop/EGW책/*.wdb 공유폴더/` 한 줄로 통째 복사해
#   형제앱이 손으로 다듬어 둔 MH.wdb · AA.wdb · ko_AA.wdb 를 덮었다.
#   내가 가진 파일만 정확히 덮였고 안 가진 것(ko_MH·ko_DA)은 멀쩡했다 —
#   원인이 통째 복사였다는 증거다.
#
#   공유 폴더는 두 앱이 함께 쓰는 자리다. **한쪽이 말없이 덮으면 남의 하루가
#   사라진다.** 그러니 도구가 막는다. 손으로 조심하는 것으로는 또 그런다.
#
# 규칙 —
#   · 없는 파일만 그대로 올린다.
#   · 이미 있으면 **건드리지 않고** 알린다. 내용이 같으면 조용히 넘어간다.
#   · 정말 바꿔야 하면 --force 를 주되, 그때도 상대 것을 .bak 로 남긴다.
#
#   python3 scripts/egw_share.py <내폴더> <공유폴더> [--force]
# ============================================================================

import hashlib
import os
import shutil
import sys
import time


def digest(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(src, dst, force):
    os.makedirs(dst, exist_ok=True)
    new = same = held = forced = 0
    conflicts = []
    for name in sorted(os.listdir(src)):
        if not name.endswith(".wdb"):
            continue
        a, b = os.path.join(src, name), os.path.join(dst, name)
        if not os.path.exists(b):
            shutil.copy2(a, b); new += 1
            continue
        if digest(a) == digest(b):
            same += 1
            continue
        if not force:
            held += 1
            conflicts.append((name, time.strftime("%m-%d %H:%M", time.localtime(os.path.getmtime(b)))))
            continue
        shutil.copy2(b, b + ".bak")          # 상대 것을 먼저 남긴다
        shutil.copy2(a, b); forced += 1
    print(f"새로 올림 {new} · 이미 같음 {same} · 다르지만 두었음 {held}"
          + (f" · 덮어씀 {forced}" if forced else ""))
    if conflicts:
        print("\n▶ 내용이 달라 **건드리지 않은** 것 — 상대가 고쳤을 수 있다")
        for n, when in conflicts:
            print(f"   {n:16} 공유본 저장 {when}")
        print("\n   상대에게 물어보고, 정말 바꿔야 할 때만 --force 를 주십시오.")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    main(sys.argv[1], sys.argv[2], "--force" in sys.argv)
