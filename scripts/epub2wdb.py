#!/usr/bin/env python3
# ============================================================================
# epub2wdb — EGW 영문 epub 을 쪽 단위 SQLite(.wdb)로 굳힌다
# ----------------------------------------------------------------------------
# 왜 이 형식인가 — EGW 인덱스는 쪽으로 말한다("소망 44"). 그 쪽수는 영문판
# 기준이라 영원히 변하지 않고, egwwritings 배포 epub 에는 쪽이 바뀌는 자리마다
# <span class="pagebreak">[44]</span> 가 박혀 있다. 그러니 이 마커로 잘라
# Egw(code, page, ptext) 로 담으면, 인덱스의 쪽수가 곧 조회 열쇠가 된다.
# 앱은 이미 SQLite(sql.js)를 읽는 몸이라 새 엔진이 필요 없다 — epub 을 앱이
# 직접 읽게 하면 zip+xhtml 렌더러를 새로 실어야 하고 구형 태블릿에 무겁다.
#
# 형제앱(함께 예수께로)은 한글 epub 을 쓰다 번역 개정판 문제(시대의 소망은
# 71%만 일치)와 씨름했다. 영문은 불변이라 그 벽이 아예 없다 — 그래서 영문.
#
#   python3 scripts/epub2wdb.py <epub폴더> <출력폴더>
#   예) python3 scripts/epub2wdb.py \
#         "/Users/ipentech/claude_code/Jonathan_CD/Gospel_Harmony/EGW" \
#         ~/Desktop/EGW책
#
# 파이썬 기본만 쓴다 (zipfile · sqlite3 · html.parser).
# ============================================================================

import html
import os
import re
import sqlite3
import sys
import zipfile

# 쪽 마커. 본문 한가운데 끼어 있다 — 마커 지점부터 그 쪽이 시작된다.
PAGEBREAK = re.compile(r'<span class="pagebreak">\[(\d+)\]</span>')
CHAPTER = re.compile(r'<h2 class="chapterhead">([^<]+)</h2>')
TAG = re.compile(r"<[^>]+>")
SPACES = re.compile(r"[ \t]+")
MANY_NL = re.compile(r"\n{3,}")

# 문단 경계를 지키며 태그를 걷어낸다. 저장은 평문(문단은 빈 줄) — 뷰어가
# 그대로 <p> 로 감싸면 되고, 남의 HTML 을 innerHTML 로 넣는 위험이 없다.
BLOCK_END = re.compile(r"</(?:p|h[1-6]|div|blockquote|li)>", re.I)


def to_text(fragment: str) -> str:
    s = BLOCK_END.sub("\n\n", fragment)
    s = re.sub(r"<br[^>]*>", "\n", s, flags=re.I)
    s = TAG.sub(" ", s)
    s = html.unescape(s)
    s = SPACES.sub(" ", s)
    s = "\n".join(line.strip() for line in s.split("\n"))
    return MANY_NL.sub("\n\n", s).strip()


def spine_files(z: zipfile.ZipFile):
    """content.opf 의 spine 차례대로 본문 파일 이름을 준다."""
    opf_name = next(n for n in z.namelist() if n.endswith(".opf"))
    opf = z.read(opf_name).decode("utf-8", "replace")
    ids = re.findall(r'<itemref[^>]*idref="([^"]+)"', opf)
    hrefs = dict(re.findall(r'<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"', opf))
    if not hrefs:  # 속성 순서가 다른 판
        for m in re.finditer(r"<item\b[^>]*>", opf):
            tag = m.group(0)
            i = re.search(r'id="([^"]+)"', tag)
            h = re.search(r'href="([^"]+)"', tag)
            if i and h:
                hrefs[i.group(1)] = h.group(1)
    base = os.path.dirname(opf_name)
    out = []
    for i in ids:
        href = hrefs.get(i)
        if href and href.endswith((".html", ".xhtml", ".htm")):
            out.append(f"{base}/{href}" if base else href)
    return out


def convert(epub_path: str, out_dir: str):
    name = os.path.splitext(os.path.basename(epub_path))[0]
    code = name[3:] if name.startswith("en_") else name  # en_DA → DA
    with zipfile.ZipFile(epub_path) as z:
        title_en = ""
        pages = {}          # page -> [텍스트 조각]
        chap_of = {}        # page -> 그 쪽이 속한 장 제목
        cur_page = 0        # 0 = 아직 첫 마커 전 (표지·서문 등)
        cur_chap = ""

        for fname in spine_files(z):
            raw = z.read(fname).decode("utf-8", "replace")
            if not title_en:
                m = re.search(r"<title>([^<]+)</title>", raw)
                if m and "front" not in fname:
                    title_en = html.unescape(m.group(1)).strip()
            m = CHAPTER.search(raw)
            if m:
                t = html.unescape(m.group(1)).strip()
                # 차례(Table of Contents) 제목이 장 이름으로 새는 것을 막는다
                if "contents" not in t.lower():
                    cur_chap = t
            body = raw.split("<body", 1)[-1]
            body = body.split(">", 1)[-1].rsplit("</body>", 1)[0]

            # 마커로 자른다. 마커 앞 조각은 직전 쪽에 이어진다 —
            # 장이 쪽 중간에서 시작하는 일이 흔하기 때문이다(소망 4장은 43쪽 중간).
            pos = 0
            for mk in PAGEBREAK.finditer(body):
                frag = body[pos:mk.start()]
                if cur_page and frag.strip():
                    pages.setdefault(cur_page, []).append(frag)
                elif cur_page == 0:
                    # 첫 마커 전의 본문 — 그 장의 시작 쪽은 (첫 마커 − 1)
                    first = int(mk.group(1))
                    # first==1 이면 앞은 표지·차례다 — 0쪽을 만들지 않는다
                    if first > 1 and frag.strip() and CHAPTER.search(frag):
                        cur_page = first - 1
                        pages.setdefault(cur_page, []).append(frag)
                        chap_of[cur_page] = cur_chap
                cur_page = int(mk.group(1))
                chap_of[cur_page] = cur_chap
                pos = mk.end()
            tail = body[pos:]
            if cur_page and tail.strip():
                pages.setdefault(cur_page, []).append(tail)
                chap_of.setdefault(cur_page, cur_chap)

    if not pages:
        return None

    out = os.path.join(out_dir, f"{code}.wdb")
    if os.path.exists(out):
        os.remove(out)
    db = sqlite3.connect(out)
    db.execute("CREATE TABLE Egw (code TEXT, page INTEGER, chapter TEXT, ptext TEXT)")
    db.execute("CREATE TABLE Meta (code TEXT, title_en TEXT, pages INTEGER)")
    db.execute("CREATE INDEX Epage ON Egw (page)")
    for p in sorted(pages):
        text = to_text("".join(pages[p]))
        if text:
            db.execute("INSERT INTO Egw VALUES (?,?,?,?)", (code, p, chap_of.get(p, ""), text))
    n = db.execute("SELECT COUNT(*), MIN(page), MAX(page) FROM Egw").fetchone()
    db.execute("INSERT INTO Meta VALUES (?,?,?)", (code, title_en, n[0]))
    db.commit()
    db.close()
    return code, title_en, n


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "."
    dst = sys.argv[2] if len(sys.argv) > 2 else "."
    os.makedirs(dst, exist_ok=True)
    epubs = sorted(f for f in os.listdir(src) if f.endswith(".epub"))
    if not epubs:
        print("epub 이 없습니다:", src)
        sys.exit(1)
    for f in epubs:
        r = convert(os.path.join(src, f), dst)
        if r:
            code, title, (cnt, lo, hi) = r
            print(f"  {code:6} {title[:34]:36} 쪽 {cnt:4}개 ({lo}~{hi})")
        else:
            print(f"  {f}: 쪽 마커를 찾지 못함 — 건너뜀")
    print("끝 —", dst)
