#!/usr/bin/env python3
# ============================================================================
# egw_coverage — EGW 인덱스의 참조 가운데 **몇 %가 앱 안에서 열리는가**
# ----------------------------------------------------------------------------
# 앱이 실제로 하는 판단을 그대로 흉내 낸다. 그러지 않으면 숫자가 부풀어
# "다 된다"고 말하게 된다.
#   · 그 코드의 .wdb 가 있는가 (한글 우선, 없으면 영문)
#   · pagekind 가 'page' 인가 — 'seq' 는 원판 쪽이 아니므로 앱도 바깥으로 보낸다
#   · 부르는 쪽이 그 책 범위 안인가 (다섯 쪽까지 넘치는 것은 뭉친 꼬리로 본다)
#
#   python3 scripts/egw_coverage.py <wdb폴더> [인덱스.cdb]
# ============================================================================

import collections
import glob
import json
import os
import re
import sqlite3
import sys

OVER = 5          # 앱과 같은 값. 이보다 크게 넘치면 앱도 바깥으로 보낸다
EDITION = re.compile(
    r"^(?:(?:ARV|RV|marg\.|var\.|Amer\.\s*Sup\.|Am\.\s*Sup\.|Leeser|Noyes|"
    r"Rotherham's\s+translation)[\s,.]*)+", re.I)


def load_books(root):
    p = os.path.join(root, "docs", "egw-books.json")
    return json.load(open(p, encoding="utf-8"))["books"]


def citations(cdb, books):
    """인덱스 한 칸씩 훑어 (코드 → [부르는 쪽]) 를 모은다. 앱의 파서와 같은 규칙."""
    out = collections.defaultdict(list)
    db = sqlite3.connect(cdb)
    for (bt,) in db.execute("SELECT btext FROM Bible WHERE btext IS NOT NULL AND btext != ''"):
        plain = re.sub(r"<b\b[^>]*>[\s\S]*?</b>", "\n", bt, flags=re.I)   # 머리줄은 성경 범위다
        plain = re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", plain))
        for ln in plain.split("\n"):
            t = EDITION.sub("", ln.strip())
            m = re.match(r"^(.*?)\s+(\d+)(?:-(\d+))?(?:\s+[A-Za-z ]+)?$", t)
            if not m:
                continue
            hit = books.get(m.group(1).strip())
            if hit:
                out[hit["code"]].append(int(m.group(2)))
    db.close()
    return out


def shelf(wdb_dir):
    """{코드: (최소쪽, 최대쪽, 원판쪽인가)} — 한글이 있으면 한글을 본다(앱과 같다)."""
    out = {}
    for f in sorted(glob.glob(os.path.join(wdb_dir, "*.wdb"))):
        code = os.path.basename(f)[:-4]
        ko = code.startswith("ko_")
        code = code[3:] if ko else code
        if code in out and not ko:
            continue                       # 한글이 이미 있으면 영문으로 덮지 않는다
        try:
            db = sqlite3.connect(f)
            lo, hi = db.execute("SELECT MIN(page), MAX(page) FROM Egw").fetchone()
            kind = "page"
            try:
                r = db.execute("SELECT pagekind FROM Meta LIMIT 1").fetchone()
                if r and r[0]:
                    kind = r[0]
            except sqlite3.Error:
                pass                        # 이 칸이 없는 옛 파일은 원판 쪽으로 본다
            db.close()
            if lo is not None:
                out[code] = (lo, hi, kind == "page")
        except sqlite3.Error:
            pass
    return out


if __name__ == "__main__":
    wdb_dir = sys.argv[1]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cdb = sys.argv[2] if len(sys.argv) > 2 else \
        "/Users/ipentech/claude_code/Jonathan_CD/Gospel_Harmony/Bible/EGW인덱스.cdb"

    books = load_books(root)
    label = {}
    for k, v in books.items():
        label.setdefault(v["code"], k)
    cite = citations(cdb, books)
    have = shelf(wdb_dir)

    total = inside = 0
    partial, missing = [], []
    for code, pages in sorted(cite.items()):
        n = len(pages)
        total += n
        if code not in have:
            missing.append((n, label.get(code, code), code, max(pages)))
            continue
        lo, hi, real = have[code]
        if not real:                       # 원판 쪽이 아니면 앱도 앱 안에서 찾지 않는다
            missing.append((n, label.get(code, code), code, max(pages)))
            continue
        ok = sum(1 for p in pages if p <= hi + OVER)
        inside += ok
        if ok < n:
            partial.append((n - ok, label.get(code, code), code, hi, max(pages), ok, n))

    print(f"인덱스 참조  {total:,}줄")
    print(f"앱 안에서 열림 {inside:,}줄  =  {inside/total*100:.1f}%")
    print(f"바깥으로 나감 {total-inside:,}줄")
    if partial:
        print(f"\n▶ 일부만 담긴 책 {len(partial)}권 — 담긴 쪽 / 인덱스가 부르는 끝")
        for miss, k, c, hi, mx, ok, n in sorted(partial, reverse=True)[:15]:
            print(f"   {k[:12]:14} {hi:5} / {mx:5}   앱 안 {ok:,}/{n:,}  (못 여는 {miss:,})")
    if missing:
        print(f"\n▶ 아예 없는 책 {len(missing)}권 — 인용 많은 순")
        for n, k, c, mx in sorted(missing, reverse=True)[:15]:
            print(f"   {k[:12]:14} {c:6} {n:6,}줄")
