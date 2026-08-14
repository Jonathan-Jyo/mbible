#!/usr/bin/env python3
# ============================================================================
# egw_fetch — egwwritings 에서 한글 본문과 **영문판 쪽번호**를 함께 받아 온다
# ----------------------------------------------------------------------------
# 왜 —
#   EGW 인덱스가 부르는 쉰여덟 권 가운데 우리가 epub 으로 구한 것은 아홉 권뿐이다.
#   인덱스 참조 121,887줄 가운데 앱 안에서 열리는 것이 28.7% 밖에 안 된다.
#   나머지는 마흔아홉 권에 고르게 흩어져 있어 한두 권 더 넣어 풀릴 문제가 아니다.
#
# 어떻게 —
#   형제앱 「함께 예수께로」가 길을 일러 주었다(2026-08-15).
#   m.egwwritings.org 는 **번역본 문단에도 영문판 쪽 표를 붙여** 내려 준다.
#
#       <p data-refcode="DA 50.1">그리스도께서 탄생하신 지 약 40일 후에…</p>
#                          ↑ 영문판 50쪽 1문단. 한글 본문인데도.
#
#   그래서 본문과 쪽번호를 **같은 응답에서** 얻는다 — 맞출 일이 아예 없다.
#   (우리가 epub 다섯 권에 들인 글자수 DP 정렬이 여기서는 필요 없다.)
#
# 남의 서버를 읽는 일이라 지키는 것 —
#   · 요청 사이 PAUSE 초를 쉰다(형제앱은 0.8초로 됐으나 우리는 권 수가 많아 넉넉히).
#   · **날것을 먼저 파일로 굳힌다.** 규칙을 고칠 때마다 다시 긁으면 남의 서버를
#     여러 번 읽게 된다(형제앱이 그 잘못을 두 번 저질렀다고 일러 주었다).
#   · 이미 받아 둔 책은 건너뛴다. 끊겨도 이어받는다.
#
#   python3 scripts/egw_fetch.py <날것폴더> [--probe|--fetch]
# ============================================================================

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"}
FOLDER = "https://m.egwwritings.org/ko/folders/1389"      # 한국어 저서 목록
BOOK = "https://m.egwwritings.org/ko/book/{}"
PAUSE = 1.7            # 초. 권 수가 많아 형제앱(0.8)보다 넉넉히 둔다
MAX_HOPS = 900         # 한 권에서 따라갈 최대 걸음 — 무한고리 방패

HEAD = re.compile(r'<h[1-6][^>]*\bdata-refcode="([A-Za-z0-9]+)\s+(\d+)"[^>]*>(.*?)</h[1-6]>', re.S)
PARA = re.compile(r'<p[^>]*\bdata-refcode="([A-Za-z0-9]+)\s+(\d+)\.(\d+)"[^>]*>(.*?)</p>', re.S)
NEXT = re.compile(r'<a[^>]*\bhref="(/[^"]*/book/[\d.]+)"[^>]*>\s*Next', re.I)
TAG = re.compile(r"<[^>]+>")


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if i == tries - 1:
                raise
            time.sleep(4 * (i + 1))      # 잠깐 물러섰다 다시 — 저쪽을 몰아붙이지 않는다
    return ""


def text_of(h):
    return re.sub(r"\s+", " ", TAG.sub(" ", h)).strip()


def book_list():
    h = get(FOLDER)
    out = {}
    for b in re.split(r'(?=<a[^>]+href="/ko/book/\d+)', h)[1:]:
        m = re.match(r'<a[^>]+href="/ko/book/(\d+)', b)
        if not m:
            continue
        nr = int(m.group(1))
        if nr in out:
            continue
        t = [x.strip() for x in re.split(r"\bRead\b|\bContents\b|\bDetails\b",
                                         text_of(b[:900])) if x.strip()]
        if t:
            out[nr] = t[0][:60]
    return out


def scrape(url):
    """한 걸음: (코드, [(쪽, 문단번호, 글)], 소제목, 다음주소)"""
    h = get(url)
    code = ""
    head = ""
    m = HEAD.search(h)
    if m:
        code, head = m.group(1), text_of(m.group(3))
    paras = []
    for p in PARA.finditer(h):
        code = code or p.group(1)
        t = text_of(p.group(4))
        if t:
            paras.append((int(p.group(2)), int(p.group(3)), t))
    n = NEXT.search(h)
    return code, paras, head, ("https://m.egwwritings.org" + n.group(1)) if n else None


def probe(books, out_dir):
    """책마다 첫 걸음만 밟아 **코드를 확인한다.** 번호를 짐작하지 않는다 —
    형제앱이 11287 을 치료봉사로 넘겨짚었다가 엉뚱한 책을 읽을 뻔했다."""
    path = os.path.join(out_dir, "booknr.json")
    known = json.load(open(path)) if os.path.exists(path) else {}
    for nr, title in sorted(books.items()):
        if str(nr) in known:
            continue
        try:
            code, paras, head, _ = scrape(BOOK.format(f"{nr}.0"))
        except Exception as e:
            print(f"  {nr} {title[:20]} — 실패 {e}")
            time.sleep(PAUSE)
            continue
        known[str(nr)] = {"code": code, "title": title}
        print(f"  {nr}  {code or '?':6} {title[:26]}")
        json.dump(known, open(path, "w"), ensure_ascii=False, indent=1)
        time.sleep(PAUSE)
    return known


def fetch_book(nr, code, title, out_dir):
    """Next 를 따라 끝까지 걷는다. 지나온 주소를 다시 만나면 멈춘다."""
    path = os.path.join(out_dir, f"{code}.json")
    if os.path.exists(path):
        return None                       # 이미 받은 것은 다시 읽지 않는다
    url = BOOK.format(f"{nr}.0")
    seen, rows, chaps, hops = set(), [], [], 0
    while url and hops < MAX_HOPS:
        if url in seen:
            break
        seen.add(url)
        hops += 1
        try:
            c, paras, head, nxt = scrape(url)
        except Exception as e:
            print(f"    {code} {hops}걸음에서 멈춤: {e}")
            break
        if paras:
            rows.extend(paras)
        if head:
            chaps.append([paras[0][0] if paras else 0, head])
        url = nxt
        time.sleep(PAUSE)
    if not rows:
        return None
    data = {"code": code, "nr": nr, "title": title, "hops": hops,
            "chapters": chaps, "paras": rows}
    json.dump(data, open(path, "w"), ensure_ascii=False)
    pages = sorted({p for p, _, _ in rows})
    print(f"  {code:6} {title[:22]:24} 걸음 {hops:4} · 문단 {len(rows):6} · 쪽 {len(pages):5} ({pages[0]}~{pages[-1]})")
    return data


if __name__ == "__main__":
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    mode = sys.argv[2] if len(sys.argv) > 2 else "--fetch"

    bl_path = os.path.join(out_dir, "booklist.json")
    if os.path.exists(bl_path):
        books = {int(k): v for k, v in json.load(open(bl_path)).items()}
    else:
        books = book_list()
        json.dump(books, open(bl_path, "w"), ensure_ascii=False, indent=1)
    print(f"목록 {len(books)}권")

    print("▶ 코드 확인 (짐작하지 않는다)")
    known = probe(books, out_dir)
    if mode == "--probe":
        sys.exit(0)

    # 이미 epub 으로 잘 만들어 둔 책은 다시 읽지 않는다 — 남의 서버를 아낀다
    HAVE = {"DA", "COL", "MH", "MB", "PP", "PK", "AA", "GC", "SC"}
    todo = [(int(nr), v["code"], v["title"]) for nr, v in known.items()
            if v["code"] and v["code"] not in HAVE]
    print(f"▶ 받을 책 {len(todo)}권 (이미 있는 {len(HAVE)}권은 건너뜀)")
    for nr, code, title in sorted(todo, key=lambda x: x[1]):
        try:
            fetch_book(nr, code, title, out_dir)
        except KeyboardInterrupt:
            print("멈춤 — 받은 데까지는 남아 있습니다"); break
        except Exception as e:
            print(f"  {code}: {e}")
    print("끝 —", out_dir)
