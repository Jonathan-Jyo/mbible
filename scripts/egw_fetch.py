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
# 남의 서버다. 급할 것이 없다 —
# 1.7초로 돌렸더니 서른여섯 권 가운데 서른 권이 503 에 막혔다. 속도를 얻으려다
# 아무것도 못 얻은 셈이다. 넉넉히 쉬는 편이 결국 빠르고, 무엇보다 예의다.
PAUSE = 6.0            # 초, 걸음 사이
BOOK_REST = 30         # 초, 책과 책 사이는 더 쉰다
BACKOFF = [60, 180, 600, 1800]   # 503 을 만나면 이만큼 물러선다
MAX_HOPS = 900         # 한 권에서 따라갈 최대 걸음 — 무한고리 방패

HEAD = re.compile(r'<h[1-6][^>]*\bdata-refcode="([A-Za-z0-9]+)\s+(\d+)"[^>]*>(.*?)</h[1-6]>', re.S)
PARA = re.compile(r'<p[^>]*\bdata-refcode="([A-Za-z0-9]+)\s+(\d+)\.(\d+)"[^>]*>(.*?)</p>', re.S)
NEXT = re.compile(r'<a[^>]*\bhref="(/[^"]*/book/[\d.]+)"[^>]*>\s*Next', re.I)
TAG = re.compile(r"<[^>]+>")


def get(url):
    """503(속도 제한)은 잠깐 쉬면 풀린다. 4초쯤 물러서는 것으로는 모자라
    스물몇 권이 통째로 끊겼다(실측). 분 단위로 길게 물러선다."""
    for i, wait in enumerate([0] + BACKOFF):
        if wait:
            print(f"      503 — {wait}초 물러섬 ({i}/{len(BACKOFF)})", flush=True)
            time.sleep(wait)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
            if i == len(BACKOFF):
                raise
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
            code, paras, head, nxt = scrape(BOOK.format(f"{nr}.0"))
            # 표지 쪽에는 refcode 가 없는 책이 있다(문서전도봉사·생애의 빛 등).
            # 코드를 못 읽었다고 그 책을 버리면 인덱스가 부르는 책을 통째로 잃는다.
            # 한 걸음만 더 들어가 본다.
            if not code and nxt:
                time.sleep(PAUSE)
                code, _p, _h, _n = scrape(nxt)
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
    """Next 를 따라 끝까지 걷는다.

    **끊긴 책은 이어받는다.** 처음에는 받은 데까지 저장하고 파일이 있으면
    건너뛰었는데, 그 바람에 503 으로 두 걸음 만에 끊긴 책이 영영 두 걸음짜리로
    남았다(청지기 6쪽, 새자녀 13쪽…). 이제 끝까지 간 책만 complete 로 적고,
    아닌 것은 다음 번에 멈춘 자리에서 다시 걷는다.
    """
    path = os.path.join(out_dir, f"{code}.json")
    rows, chaps, seen, hops = [], [], set(), 0
    url = BOOK.format(f"{nr}.0")
    if os.path.exists(path):
        d = json.load(open(path))
        if d.get("complete"):
            return None                    # 다 받은 것은 다시 읽지 않는다
        rows, chaps = d["paras"], d.get("chapters", [])
        seen = set(d.get("seen", []))
        url = d.get("next") or url
        if url in seen:
            return None
        print(f"  {code:6} 이어받기 — {len(rows)}문단부터", flush=True)

    def save(complete, nxt):
        json.dump({"code": code, "nr": nr, "title": title, "complete": complete,
                   "next": nxt, "seen": sorted(seen), "chapters": chaps, "paras": rows},
                  open(path, "w"), ensure_ascii=False)

    done = False
    while url and hops < MAX_HOPS:
        if url in seen:
            done = True
            break
        seen.add(url)
        hops += 1
        try:
            _c, paras, head, nxt = scrape(url)
        except Exception as e:
            print(f"    {code} {hops}걸음에서 멈춤(이어받을 수 있음): {e}", flush=True)
            save(False, url)               # 못 읽은 그 자리를 다음 번 출발점으로
            return None
        if paras:
            rows.extend(paras)
        if head:
            chaps.append([paras[0][0] if paras else 0, head])
        url = nxt
        if not url:
            done = True
        if hops % 20 == 0:
            save(False, url)               # 도중에도 굳혀 둔다 — 끊겨도 잃지 않는다
        time.sleep(PAUSE)
    save(done, url)
    if not rows:
        return None
    pages = sorted({p for p, _, _ in rows})
    mark = "" if done else "  ← 아직 덜 받음"
    print(f"  {code:6} {title[:22]:24} 걸음 {hops:4} · 문단 {len(rows):6} · 쪽 {len(pages):5} ({pages[0]}~{pages[-1]}){mark}", flush=True)
    return rows


# ============================================================================
# 날것(raw/*.json) → .wdb
#   python3 scripts/egw_fetch.py <날것폴더> --build <출력폴더>
# ============================================================================
def build_wdb(raw_dir, out_dir):
    import sqlite3, glob
    os.makedirs(out_dir, exist_ok=True)
    made = 0
    for f in sorted(glob.glob(os.path.join(raw_dir, "*.json"))):
        base = os.path.basename(f)
        if base in ("booklist.json", "booknr.json"):
            continue
        d = json.load(open(f))
        code, title = d["code"], d["title"]
        # 문단 글 끝에 제 refcode 가 붙어 온다("…을 예언한다. 1T 6.2") — 떼어 낸다
        tail = re.compile(r"\s*" + re.escape(code) + r"\s+\d+\.\d+\s*$")
        chap_at = {p: t for p, t in d.get("chapters", [])}
        bypage, chapof, cur = {}, {}, ""
        for page, _no, text in d["paras"]:
            t = tail.sub("", text).strip()
            if not t:
                continue
            if page in chap_at:
                cur = chap_at[page]
            bypage.setdefault(page, []).append(t)
            chapof.setdefault(page, cur)
        if not bypage:
            continue
        path = os.path.join(out_dir, f"ko_{code}.wdb")
        if os.path.exists(path):
            os.remove(path)
        db = sqlite3.connect(path)
        db.execute("CREATE TABLE Egw (code TEXT, page INTEGER, chapter TEXT, ptext TEXT)")
        db.execute("CREATE TABLE Meta (code TEXT, title_en TEXT, pages INTEGER, pagekind TEXT)")
        db.execute("CREATE TABLE Book (code TEXT, lang TEXT, title TEXT, source TEXT)")
        db.execute("CREATE INDEX Epage ON Egw (page)")
        for p in sorted(bypage):
            db.execute("INSERT INTO Egw VALUES (?,?,?,?)",
                       (code, p, chapof.get(p, ""), "\n\n".join(bypage[p])))
        n = db.execute("SELECT COUNT(*), MIN(page), MAX(page) FROM Egw").fetchone()
        # 쪽은 egwwritings 가 붙여 준 **영문판 쪽**이다 — 지어낸 번호가 아니다
        db.execute("INSERT INTO Meta VALUES (?,?,?,?)", (code, title, n[0], "page"))
        db.execute("INSERT INTO Book VALUES (?,?,?,?)", (code, "ko", title, "egwwritings.org"))
        db.commit(); db.close()
        made += 1
        print(f"  ko_{code:6} {title[:22]:24} 쪽 {n[0]:5} ({n[1]}~{n[2]})")
    print(f"끝 — {made}권 → {out_dir}")


if __name__ == "__main__":
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    mode = sys.argv[2] if len(sys.argv) > 2 else "--fetch"
    if mode == "--build":
        build_wdb(out_dir, sys.argv[3]); sys.exit(0)

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
            if fetch_book(nr, code, title, out_dir):
                time.sleep(BOOK_REST)
        except KeyboardInterrupt:
            print("멈춤 — 받은 데까지는 남아 있습니다"); break
        except Exception as e:
            print(f"  {code}: {e}")
    print("끝 —", out_dir)
