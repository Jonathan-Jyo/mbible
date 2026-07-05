#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
베들레헴 성경 로컬 조회 서버
────────────────────────────
verse-converter-local.html 이 API.Bible 대신 이 로컬 서버를 호출해
베들레헴 성경 DB(.bdb = SQLite)에서 직접 구절을 가져오도록 한다.

· 네트워크 호출 없음 (전부 로컬 SQLite 조회)
· API 키, 요청 제한, 라이선스 승인 문제 없음
· .bdb 파일 자체가 이미 SQLite 3 포맷이라 표준 sqlite3 모듈로 바로 읽음

실행:
    python3 tools/bethlehem-server.py
    (기본 포트 8899, http://127.0.0.1:8899)
"""

import json
import re
import sqlite3
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = 8899

# .bdb 파일들이 들어있는 실제 폴더 (절대경로로 고정 — 어디서 실행해도 무관)
BDB_DIR = Path(
    "/Users/ipentech/claude_code/Jonathan_CD/성경절암송/Refferance/참고/"
    "베들레헴 성경/bethlehem_ios"
)

# UI 언어코드 → 실제 사용 가능한 .bdb 파일(확장자 제외) 목록
# (드롭다운에 노출할 표시명, 파일명) 순서 = 기본 선택 우선순위
VERSIONS = {
    "ko": [
        ("새번역 (대한성서공회)", "새번역"),
        ("개역개정", "개역개정"),
        ("현대인의 성경", "현대인"),
        ("새한글 성경", "새한글"),
        ("두란노 우리말성경", "우리말"),
        ("아가페 쉬운성경", "쉬운성경"),
        ("공동번역", "공동번역"),
        ("국한문 개역한글판", "국한문개역"),
        ("킹제임스 흠정역", "킹흠정역"),
        ("한글킹제임스", "한글킹"),
    ],
    "en": [
        ("NIV (2011)", "NIV2011"),
        ("NIV (1984)", "NIV1984"),
        ("ESV", "ESV"),
        ("NKJV", "NKJV"),
        ("KJV (1611)", "KJV1611"),
        ("NASB (1995)", "NAS1995"),
        ("RSV", "RSV"),
        ("NLT", "NLT"),
        ("CSB", "CSB"),
        ("BSB", "BSB"),
        ("AMP", "AMP"),
        ("YLT", "YLT"),
        ("MSG (The Message)", "MSG"),
    ],
    "ja": [
        ("新改訳", "일본신개역"),
        ("口語訳", "일본구어역"),
    ],
    "zh": [
        ("和合本 (簡体)", "중문화간체"),
        ("和合本 (繁體)", "중문신번체"),
    ],
    "in": [
        ("Terjemahan Baru", "인도네시아"),
    ],
}

# ── USFM 3자리 코드 → 베들레헴 DB book 번호(1~66, 표준 개신교 정경 순서) ──
BOOK_ORDER = [
    "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA",
    "1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO",
    "ECC","SNG","ISA","JER","LAM","EZK","DAN","HOS","JOL","AMO",
    "OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL",
    "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH",
    "PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS",
    "1PE","2PE","1JN","2JN","3JN","JUD","REV",
]
BOOK_NUM = {code: i + 1 for i, code in enumerate(BOOK_ORDER)}

_TAG_RE = re.compile(r"<[^>]+>")
_FOOTNOTE_RE = re.compile(r"→.*$", re.S)
_CIRCLED_DIGIT_RE = re.compile(r"[①-⑳]")


def clean_text(raw):
    """<sup>, <br>, <J> 등 마크업, 꼬리 각주(→ ...), 각주 마커(①~⑳)를 제거해 순수 본문만 남긴다."""
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


def query_verse(filename, book_num, chapter, verse):
    path = BDB_DIR / f"{filename}.bdb"
    if not path.exists():
        raise FileNotFoundError(f"DB 파일 없음: {filename}.bdb")
    conn = sqlite3.connect(str(path))
    try:
        tbl = table_name(conn)
        row = conn.execute(
            f'SELECT btext FROM "{tbl}" WHERE book=? AND chapter=? AND verse=?',
            (book_num, chapter, verse),
        ).fetchone()
        if not row:
            raise LookupError(f"{filename}: {book_num}장 {chapter}:{verse} 절을 찾을 수 없음")
        return clean_text(row[0])
    finally:
        conn.close()


def parse_usfm(usfm):
    m = re.match(r"^([1-3A-Z]{2,4})\.(\d+)\.(\d+)$", usfm)
    if not m:
        raise ValueError(f"참조 형식 오류: {usfm}")
    code, chapter, verse = m.group(1), int(m.group(2)), int(m.group(3))
    if code not in BOOK_NUM:
        raise ValueError(f"알 수 없는 책 코드: {code}")
    return BOOK_NUM[code], chapter, verse


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        # Chrome/Safari Private Network Access: file:// 또는 외부 origin에서
        # 127.0.0.1(로컬망)로 접근할 때 프리플라이트에 이 헤더가 없으면 차단됨.
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json({})

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        if parsed.path == "/versions":
            self._send_json({"versions": VERSIONS})
            return

        if parsed.path == "/lookup":
            usfm = (qs.get("ref") or [""])[0]
            filename = (qs.get("file") or [""])[0]
            try:
                book, chapter, verse = parse_usfm(usfm)
                text = query_verse(filename, book, chapter, verse)
                self._send_json({
                    "ok": True,
                    "text": text,
                    "reference": f"{usfm.split('.')[0]} {chapter}:{verse}",
                })
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, status=400)
            return

        self._send_json({"ok": False, "error": "not found"}, status=404)

    def log_message(self, fmt, *args):
        print("[bethlehem-server]", fmt % args)


def main():
    if not BDB_DIR.exists():
        raise SystemExit(f"DB 폴더를 찾을 수 없습니다: {BDB_DIR}")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"베들레헴 성경 로컬 서버 시작: http://127.0.0.1:{PORT}")
    print(f"DB 폴더: {BDB_DIR}")
    print("종료: Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
