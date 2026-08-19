#!/usr/bin/env python3
# ============================================================================
# egw_status — 수확이 어디까지 왔는지 한눈에
# ----------------------------------------------------------------------------
# 제작자가 "진행 속도를 가늠할 수 있게 시간마다 알려 달라" 고 하셨다.
# 그래서 **속도**를 함께 낸다 — 지난번 잰 것과 견주어 시간당 몇 쪽인지.
# 잰 값은 .status_prev.json 에 두고 다음 번에 견준다.
#
#   python3 scripts/egw_status.py <EGW폴더>
# ============================================================================

import json
import os
import sys
import time

NINE = ["DA", "PP", "PK", "AA", "GC", "MB", "MH", "COL", "SC"]


def scan(d):
    """{코드: (완료?, 쪽수, 문단수)}"""
    out = {}
    if not os.path.isdir(d):
        return out
    for f in os.listdir(d):
        if not f.endswith(".json") or f in ("booklist.json", "booknr.json"):
            continue
        try:
            j = json.load(open(os.path.join(d, f)))
        except Exception:
            continue
        pages = {p for p, _, _ in j.get("paras", [])}
        out[j.get("code", f[:-5])] = (bool(j.get("complete")), len(pages), len(j.get("paras", [])))
    return out


def main(E):
    ko, en = scan(f"{E}/raw"), scan(f"{E}/raw_en")
    now = time.time()

    print(f"■ EGW 수확 — {time.strftime('%m월 %d일 %H:%M')}")
    print()
    print("  아홉 권 (짝을 이루면 영한대역이 된다)")
    for c in NINE:
        def cell(t):
            if c not in t:
                return "     –      "
            done, pg, _ = t[c]
            return f"{'✔' if done else '…'} {pg:>4}쪽    "
        print(f"    {c:4} 한글 {cell(ko)} 영문 {cell(en)}")

    kd = sum(1 for v in ko.values() if v[0])
    ed = sum(1 for v in en.values() if v[0])
    kp = sum(v[1] for v in ko.values())
    ep = sum(v[1] for v in en.values())
    print()
    print(f"  전체   한글 {kd}권 완료 · {kp:,}쪽     영문 {ed}권 완료 · {ep:,}쪽")

    # 속도 — 지난번과 견준다
    prev_path = f"{E}/.status_prev.json"
    if os.path.exists(prev_path):
        try:
            p = json.load(open(prev_path))
            dt = (now - p["t"]) / 3600.0
            if dt > 0.05:
                dp = (kp + ep) - (p["kp"] + p["ep"])
                dbk = (kd + ed) - (p["kd"] + p["ed"])
                print(f"  속도   지난 {dt:.1f}시간에 {dp:,}쪽 · {dbk}권"
                      f"  (시간당 약 {dp/dt:,.0f}쪽)")
        except Exception:
            pass
    json.dump({"t": now, "kp": kp, "ep": ep, "kd": kd, "ed": ed},
              open(prev_path, "w"))

    # 지금 받는 중인 것
    busy = [f"한글 {c}" for c, v in ko.items() if not v[0]] + \
           [f"영문 {c}" for c, v in en.items() if not v[0]]
    if busy:
        print(f"  받는 중 {' · '.join(busy)}")
    alive = os.popen("pgrep -f egw_fetch | wc -l").read().strip()
    print(f"  수확기 {'돌고 있음' if alive != '0' else '★멈춤'}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1
         else "/Users/ipentech/claude_code/Jonathan_CD/Gospel_Harmony/EGW")
