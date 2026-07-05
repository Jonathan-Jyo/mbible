#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
베들레헴 성경 DB(.bdb = SQLite) → 앱 번들용 JSON 변환 (1회 실행, 빌드 타임)
────────────────────────────────────────────────────────────────────────
7개 번역본 × 66권을 책 단위 JSON 파일로 변환해
data/bible-db/{01..66}.json 에 저장한다.

· 서버 불필요 — 변환된 JSON은 Netlify에 정적 파일로 그대로 배포됨
· 앱은 필요한 책 1개 파일만 fetch (책당 5개 언어 합쳐 수백KB 수준)

실행:
    python3 tools/convert-bethlehem-to-json.py
"""

import json
import re
import sqlite3
from pathlib import Path

BDB_DIR = Path(
    "/Users/ipentech/claude_code/Jonathan_CD/성경절암송/Refferance/참고/"
    "베들레헴 성경/bethlehem_ios"
)
OUT_DIR = Path("/Users/ipentech/claude_code/Jonathan_CD/성경절암송/data/bible-db")

# version-key → (파일명, 테이블 케이스 자동 감지)
VERSIONS = {
    "ko_gae":  "개역개정",
    "ko_new":  "새번역",
    "en_nkjv": "NKJV",
    "en_esv":  "ESV",
    "ja":      "일본신개역",
    "zh":      "중문화간체",
    "in":      "인도네시아",
}

BOOK_ORDER = [
    "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA",
    "1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO",
    "ECC","SNG","ISA","JER","LAM","EZK","DAN","HOS","JOL","AMO",
    "OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL",
    "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH",
    "PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS",
    "1PE","2PE","1JN","2JN","3JN","JUD","REV",
]

_TAG_RE = re.compile(r"<[^>]+>")
_FOOTNOTE_RE = re.compile(r"→.*$", re.S)
_CIRCLED_DIGIT_RE = re.compile(r"[①-⑳]")  # ①~⑳ 각주 마커


def clean_text(raw):
    if not raw:
        return ""
    text = _FOOTNOTE_RE.sub("", raw)
    text = _TAG_RE.sub("", text)
    text = _CIRCLED_DIGIT_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def table_name(conn):
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND lower(name)='bible' LIMIT 1"
    ).fetchone()
    return row[0] if row else "Bible"


def load_version(filename):
    """{ (book,chapter,verse): text } 전체를 메모리에 올린다."""
    path = BDB_DIR / f"{filename}.bdb"
    conn = sqlite3.connect(str(path))
    tbl = table_name(conn)
    rows = conn.execute(f'SELECT book, chapter, verse, btext FROM "{tbl}"').fetchall()
    conn.close()
    return {(b, c, v): clean_text(t) for (b, c, v, t) in rows}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("버전별 DB 로딩 중...")
    data_by_version = {}
    for vkey, filename in VERSIONS.items():
        path = BDB_DIR / f"{filename}.bdb"
        if not path.exists():
            raise SystemExit(f"파일 없음: {path}")
        data_by_version[vkey] = load_version(filename)
        print(f"  {vkey:10} ({filename}) — {len(data_by_version[vkey])}절 로드")

    total_size = 0
    for book_num, abbr in enumerate(BOOK_ORDER, start=1):
        verses = {}
        for vkey, verse_map in data_by_version.items():
            for (b, c, v), text in verse_map.items():
                if b != book_num:
                    continue
                key = f"{c}.{v}"
                verses.setdefault(key, {})[vkey] = text

        out = {
            "book": book_num,
            "abbr": abbr,
            "versions": list(VERSIONS.keys()),
            "verses": verses,
        }
        out_path = OUT_DIR / f"{book_num:02d}.json"
        text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
        out_path.write_text(text, encoding="utf-8")
        total_size += len(text.encode("utf-8"))
        print(f"  {book_num:02d}.json ({abbr}) — {len(verses)}절, {len(text)/1024:.1f}KB")

    print(f"\n완료: {len(BOOK_ORDER)}개 파일, 총 {total_size/1048576:.1f}MB (비압축)")


if __name__ == "__main__":
    main()
