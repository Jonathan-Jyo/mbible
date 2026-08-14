#!/usr/bin/env python3
# ============================================================================
# egw_align — 한글 EGW epub 에 **영문판 쪽번호**를 물려 .wdb 로 굳힌다
# ----------------------------------------------------------------------------
# 왜 이것이 필요한가 —
#   EGW 인덱스는 「부조 44」처럼 **영문판 쪽**으로 말한다. 그 쪽수는 영원히
#   변하지 않아 좋은 열쇠지만, 한글 epub 에는 쪽 표시가 **하나도 없다**
#   (영문 747개 / 한글 0개, 실측). 그래서 한글 본문을 영문 문단에 맞춰 놓고
#   짝의 쪽번호를 물려받게 한다. 그러면 한 벌의 열쇠로 두 말이 다 열린다.
#
#   그 덕에 대역도 저절로 된다 — 두 파일이 같은 쪽번호를 쓰므로 44쪽을
#   나란히 놓기만 하면 된다. 앱에 새 표도, 새 스키마도 필요 없다.
#
# 맞추는 법 —
#   ① 장은 이미 1:1 이다(73/73·60/60·58/58·42/42·13/13 실측). 장 안에서만
#      맞추므로 어긋남이 책 전체로 번지지 않는다.
#   ② 장 안에서는 글자 수 흐름으로 맞춘다(DP). 판마다 시·성경 인용을 끊는
#      자리가 달라 문단이 1:1 이 아니므로, 1:2·2:1 붙임을 허용한다.
#   ③ 짝을 찾은 한글 문단은 그 영문 문단이 놓인 쪽을 물려받는다.
#
# 스키마는 영문판과 **똑같다** — 형제앱과 맞춘 것이고, 앱은 이 파일이 한글인지
# 영문인지 이름(ko_ 접두)으로만 가린다.
#     Egw (code, page, chapter, ptext) · Meta (code, title_en, pages)
#     Book(code, lang, title, source)   ← 한글임을 밝히는 덧붙임 표(형제앱 규약)
#
#   python3 scripts/egw_align.py <epub폴더> <출력폴더>
# ============================================================================

import html
import os
import re
import sqlite3
import sys
import zipfile

PAGEBREAK = re.compile(r'<span class="pagebreak">\[(\d+)\]</span>')
ENCHAP = re.compile(r'<h2 class="chapterhead">\s*(Chap\.[^<]*)</h2>')
KOCHAP = re.compile(r"^제\s*\d+\s*장")
TAG = re.compile(r"<[^>]+>")

# 한글 epub ↔ 영문 epub ↔ 코드. 이름이 제각각이라 표로 못박는다.
PAIRS = [
    ("부조와 선지자.epub",     "Patriarchs and Prophets.epub",   "PP", "부조와 선지자"),
    ("선지자와 왕.epub",       "Prophets and Kings.epub",        "PK", "선지자와 왕"),
    ("사도행적.epub",          "The Acts of the Apostles.epub",  "AA", "사도행적"),
    ("각 시대의 대쟁투.epub",   "The Great Controversy.epub",     "GC", "각 시대의 대쟁투"),
    ("정로의 계단.epub",       "Steps to Christ.epub",           "SC", "정로의 계단"),
]
# 짝이 없는 책 — 그 말로만 읽는다. 원판 쪽을 알 수 없으므로 쪽번호를 지어내지
# 않고 '이 판 자체 번호'임을 Meta 에 적어 둔다(pagekind='seq').
SOLO = [
    ("생애의 빛.epub",           "LIGHT", "ko", "생애의 빛"),
    ("엘렌 지 화잇 자서전.epub",  "LS",    "ko", "엘렌 지 화잇 자서전"),
    ("To Be Like Jesus.epub",   "TBLJ",  "en", "To Be Like Jesus"),
]


def spine(z):
    opf = next(n for n in z.namelist() if n.endswith(".opf"))
    s = z.read(opf).decode("utf-8", "replace")
    ids = re.findall(r'<itemref[^>]*idref="([^"]+)"', s)
    hrefs = dict(re.findall(r'<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"', s))
    base = os.path.dirname(opf)
    out = []
    for i in ids:
        h = hrefs.get(i, "")
        if h.endswith((".html", ".xhtml", ".htm")):
            out.append(f"{base}/{h}" if base else h)
    return out


def clean(s):
    s = TAG.sub("", s)
    s = html.unescape(s).replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def en_paragraphs(z):
    """영문: (문단글, 쪽, 장이름) 차례대로. 쪽 표시를 따라가며 쪽을 매긴다."""
    out, page, chap = [], 0, ""
    for n in spine(z):
        raw = z.read(n).decode("utf-8", "replace")
        m = ENCHAP.search(raw)
        if m:
            chap = clean(m.group(1))
        body = raw.split("<body", 1)[-1].split(">", 1)[-1].rsplit("</body>", 1)[0]
        # 쪽 표시는 문단 **안**에 박혀 있다. 그래서 문단 정규식으로 함께 훑으면
        # <p>…</p> 가 표시를 통째로 삼켜 버린다(쪽이 0으로 남는다).
        # 자리(offset)로 따로 재어, 문단이 **시작하는** 자리의 쪽을 그 문단의 쪽으로 삼는다.
        marks = [(m.start(), int(m.group(1))) for m in PAGEBREAK.finditer(body)]
        mi = 0
        for pm in re.finditer(r"<p\b[^>]*>(.*?)</p>", body, re.S | re.I):
            while mi < len(marks) and marks[mi][0] <= pm.start():
                page = marks[mi][1]
                mi += 1
            t = clean(pm.group(1))
            if t:
                out.append((t, page, chap))
        while mi < len(marks):          # 마지막 문단 뒤의 표시도 흘려보내지 않는다
            page = marks[mi][1]
            mi += 1
    return out


def ko_paragraphs(z):
    """한글: (문단글, 장번호). 장은 '제 N 장' 으로 시작하는 문단에서 갈린다."""
    out, chap = [], 0
    for n in spine(z):
        raw = z.read(n).decode("utf-8", "replace")
        body = raw.split("<body", 1)[-1].split(">", 1)[-1].rsplit("</body>", 1)[0]
        for m in re.finditer(r"<p\b[^>]*>(.*?)</p>", body, re.S | re.I):
            t = clean(m.group(1))
            if not t:
                continue
            if KOCHAP.match(t):
                chap += 1
            out.append((t, chap))
    return out


def group_chapters(en, ko):
    """영문·한글을 장 단위로 나란히 세운다. 앞자료(장 0)는 맞추지 않는다."""
    ec, ko_c = {}, {}
    ci = 0
    last = None
    for t, page, chap in en:
        if chap != last:
            last = chap
            ci = ci + 1 if chap.startswith("Chap.") else ci
        if chap.startswith("Chap."):
            ec.setdefault(ci, []).append((t, page, chap))
    for t, chap in ko:
        if chap:
            ko_c.setdefault(chap, []).append(t)
    return ec, ko_c


def align(ko_list, en_list):
    """장 하나를 맞춘다 → [(한글묶음, 영문묶음)]. 1:1·1:2·2:1 을 허용한다.

    글자 수 흐름으로 맞춘다. 한글은 같은 뜻을 영문보다 짧게 적으므로 비율을
    책마다 재어 쓴다(고정값을 박으면 책이 바뀔 때 어긋난다).
    """
    n, m = len(ko_list), len(en_list)
    if not n or not m:
        return [(ko_list, en_list)] if (ko_list or en_list) else []
    kl = [len(x) for x in ko_list]
    el = [len(x[0]) for x in en_list]
    ratio = (sum(kl) / sum(el)) if sum(el) else 1.0

    def cost(k_from, k_to, e_from, e_to):
        a = sum(kl[k_from:k_to])
        b = sum(el[e_from:e_to]) * ratio
        return abs(a - b) / max(1.0, (a + b) / 2)

    INF = float("inf")
    D = [[INF] * (m + 1) for _ in range(n + 1)]
    P = [[None] * (m + 1) for _ in range(n + 1)]
    D[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            if D[i][j] == INF:
                continue
            for di, dj in ((1, 1), (1, 2), (2, 1)):
                if i + di > n or j + dj > m:
                    continue
                c = D[i][j] + cost(i, i + di, j, j + dj) + (0.0 if (di, dj) == (1, 1) else 0.35)
                if c < D[i + di][j + dj]:
                    D[i + di][j + dj] = c
                    P[i + di][j + dj] = (i, j)
    if D[n][m] == INF:                       # 길이가 너무 어긋나 길이 없으면 통째로
        return [(ko_list, en_list)]
    out, i, j = [], n, m
    while (i, j) != (0, 0):
        pi, pj = P[i][j]
        out.append((ko_list[pi:i], en_list[pj:j]))
        i, j = pi, pj
    return out[::-1]


def write_wdb(path, code, title, rows, pagekind, lang, source):
    """rows: [(page, chapter, text)] — 같은 쪽은 한 줄로 모은다."""
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE Egw (code TEXT, page INTEGER, chapter TEXT, ptext TEXT)")
    db.execute("CREATE TABLE Meta (code TEXT, title_en TEXT, pages INTEGER, pagekind TEXT)")
    db.execute("CREATE TABLE Book (code TEXT, lang TEXT, title TEXT, source TEXT)")
    db.execute("CREATE INDEX Epage ON Egw (page)")
    bypage = {}
    chapof = {}
    for page, chap, text in rows:
        if not text:
            continue
        bypage.setdefault(page, []).append(text)
        if page not in chapof:
            chapof[page] = chap
    for p in sorted(bypage):
        db.execute("INSERT INTO Egw VALUES (?,?,?,?)",
                   (code, p, chapof.get(p, ""), "\n\n".join(bypage[p])))
    n = db.execute("SELECT COUNT(*), MIN(page), MAX(page) FROM Egw").fetchone()
    db.execute("INSERT INTO Meta VALUES (?,?,?,?)", (code, title, n[0], pagekind))
    db.execute("INSERT INTO Book VALUES (?,?,?,?)", (code, lang, title, source))
    db.commit()
    db.close()
    return n


def build_pair(src, dst, ko_file, en_file, code, ko_title):
    zk = zipfile.ZipFile(os.path.join(src, ko_file))
    ze = zipfile.ZipFile(os.path.join(src, en_file))
    en = en_paragraphs(ze)
    ko = ko_paragraphs(zk)
    ec, kc = group_chapters(en, ko)

    # ── 영문: 쪽 그대로 ────────────────────────────────────────────────
    title_en = ""
    m = re.search(r"<title>([^<]+)</title>", ze.read(spine(ze)[0]).decode("utf-8", "replace"))
    if m:
        title_en = clean(m.group(1))
    en_rows = [(p, c, t) for (t, p, c) in en if p]
    ne = write_wdb(os.path.join(dst, f"{code}.wdb"), code, title_en or en_file[:-5],
                   en_rows, "page", "en", en_file)

    # ── 한글: 영문 쪽을 물려받는다 ─────────────────────────────────────
    ko_rows, paired, orphan = [], 0, 0
    # 앞자료(머리말·서문 등, 장 0)는 맞출 상대가 없다 — 첫 장 앞 쪽에 얹는다
    first_page = min((p for _, p, _ in en if p), default=1)
    for t, chap in ko:
        if chap == 0:
            ko_rows.append((max(1, first_page - 1), "앞자료", t))
    for ci in sorted(kc):
        klist, elist = kc[ci], ec.get(ci, [])
        if not elist:
            orphan += len(klist)
            continue
        chap_name = elist[0][2]
        for kgrp, egrp in align(klist, elist):
            page = egrp[0][1] if egrp else (ko_rows[-1][0] if ko_rows else first_page)
            for t in kgrp:
                ko_rows.append((page, chap_name, t))
                paired += 1
    nk = write_wdb(os.path.join(dst, f"ko_{code}.wdb"), code, ko_title,
                   ko_rows, "page", "ko", ko_file)
    print(f"  {code:5} 영문 쪽 {ne[0]:4} ({ne[1]}~{ne[2]})   한글 쪽 {nk[0]:4} ({nk[1]}~{nk[2]})"
          f"   짝 지은 문단 {paired}" + (f"  · 짝 못 찾음 {orphan}" if orphan else ""))


def build_solo(src, dst, fname, code, lang, title):
    """짝이 없는 책 — 원판 쪽을 알 수 없다. 쪽번호를 지어내지 않고
    '이 판 자체 번호'임을 pagekind='seq' 로 밝힌다. 인덱스는 이 책을
    앱 안에서 찾지 않고 바깥으로 보낸다."""
    z = zipfile.ZipFile(os.path.join(src, fname))
    rows, page, chap, buf = [], 0, "", 0
    for n in spine(z):
        raw = z.read(n).decode("utf-8", "replace")
        m = ENCHAP.search(raw)
        body = raw.split("<body", 1)[-1].split(">", 1)[-1].rsplit("</body>", 1)[0]
        ps = [clean(x.group(1)) for x in re.finditer(r"<p\b[^>]*>(.*?)</p>", body, re.S | re.I)]
        ps = [p for p in ps if p]
        if not ps:
            continue
        if m:
            chap = clean(m.group(1))
        elif KOCHAP.match(ps[0]) or (lang == "ko" and page == 0):
            chap = ps[0][:40]
        for t in ps:
            if buf == 0 or buf > 1600:       # 한 쪽에 1,600자쯤 — 읽기 좋은 덩이
                page += 1
                buf = 0
            rows.append((page, chap, t))
            buf += len(t)
    n = write_wdb(os.path.join(dst, ("ko_" if lang == "ko" else "") + f"{code}.wdb"),
                  code, title, rows, "seq", lang, fname)
    print(f"  {code:5} {lang} 단독 · 쪽(이 판 번호) {n[0]:4} ({n[1]}~{n[2]})")


if __name__ == "__main__":
    src = sys.argv[1]
    dst = sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    print("▶ 짝 있는 책 — 한글에 영문 쪽을 물려준다")
    for ko_f, en_f, code, title in PAIRS:
        if os.path.exists(os.path.join(src, ko_f)) and os.path.exists(os.path.join(src, en_f)):
            build_pair(src, dst, ko_f, en_f, code, title)
        else:
            print(f"  {code}: epub 을 찾지 못함 — 건너뜀")
    print("▶ 짝 없는 책 — 그 말로만")
    for fname, code, lang, title in SOLO:
        if os.path.exists(os.path.join(src, fname)):
            build_solo(src, dst, fname, code, lang, title)
    print("끝 —", dst)
