#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
번들 역본 JSON(data/bible-db/*.json) → 역본별 SQLite(.db)로 변환 (DB 우선 전환용)
──────────────────────────────────────────────────────────────────────────────
· 8개 번들 역본 각각을 data/bible-sqlite/{version}.db 로 생성
· 스키마는 베들레헴 .bdb와 동일: Bible(book, chapter, verse, btext) + 인덱스
  → 리더가 사용자 .bdb와 완전히 동일한 sql.js 경로로 읽기·검색
· 본문은 이미 정리된 JSON 텍스트 그대로 (마크업 없음)

실행: python3 tools/json-to-sqlite.py
"""

import json
import sqlite3
from pathlib import Path

ROOT = Path("/Users/ipentech/claude_code/Jonathan_CD/성경절암송")
SRC = ROOT / "data" / "bible-db"
OUT = ROOT / "data" / "bible-sqlite"

VERSIONS = ["ko_gae", "ko_new", "en_nkjv", "en_esv", "ja", "zh", "zh_trad", "in"]


def build_version(version):
    out_path = OUT / f"{version}.db"
    if out_path.exists():
        out_path.unlink()
    conn = sqlite3.connect(str(out_path))
    cur = conn.cursor()
    cur.execute('CREATE TABLE "Bible" (book INTEGER, chapter INTEGER, verse INTEGER, btext TEXT)')
    rows = 0
    for book_num in range(1, 67):
        f = SRC / f"{book_num:02d}.json"
        data = json.loads(f.read_text(encoding="utf-8"))
        batch = []
        for key, cell in data["verses"].items():
            text = cell.get(version)
            if not text:
                continue
            c, v = key.split(".")
            batch.append((book_num, int(c), int(v), text))
        if batch:
            cur.executemany('INSERT INTO "Bible" (book, chapter, verse, btext) VALUES (?,?,?,?)', batch)
            rows += len(batch)
    cur.execute('CREATE INDEX "Bindex" ON "Bible" (book, chapter, verse)')
    conn.commit()
    conn.execute("VACUUM")
    conn.close()
    size = out_path.stat().st_size / 1048576
    print(f"  {version:9} {rows:6d}절  {size:5.1f}MB  → {out_path.name}")
    return out_path.stat().st_size


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    print("번들 역본 SQLite 변환:")
    for v in VERSIONS:
        total += build_version(v)
    print(f"\n완료: {len(VERSIONS)}개 .db, 총 {total/1048576:.1f}MB")


if __name__ == "__main__":
    main()
