#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
찬미가 유튜브 링크 PDF → 앱이 읽는 음원 표(.json) 만들기

  python3 parse-hymn-pdf.py "찬미가 759장 장별 유투브 링크정리.pdf"

만드는 것 (기본 role 은 반주):
  찬미가-유튜브-반주.json        곡마다 대표 링크 하나
  찬미가-유튜브-찬양.json        PDF에 '찬양'이라 적힌 것만
  찬미가-유튜브-반주-다른연주.json  한 곡에 링크가 여러 개일 때 나머지

앱에서 — 매일찬양 › 찬미가 › 곡 열기 › 🎵 음원 › [표 가져오기]

── PDF 생김새 (실제로 확인한 것) ────────────────────────────────────
  곡 머리줄이 두 가지다
      1장 성부와 성자 성령
      019 전능 왕 오셔서: 19장
  그 아래에 youtu.be 주소가 한 줄에 하나씩. 대개 표기가 없고,
  아주 드물게 앞에 '반주'/'찬양'이 붙는다(12·13장).
  한 곡에 주소가 둘 이상이면 다른 연주다(연주자 이름이 적힌 곳도 있다).

  표기가 없는 것은 '반주'로 본다 — 이 PDF의 음원은 adventist.or.kr
  찬미가 플레이어의 MR과 같은 것이기 때문이다(사용자 확인).
"""

import json, os, re, subprocess, sys, tempfile

YT = re.compile(r"(?:youtu\.be/|youtube\.com/watch\?v=|youtube\.com/embed/|youtube\.com/shorts/)([\w-]{11})")
# 곡 머리줄 — 실제 PDF에 나온 생김새를 모두 받는다
#   1장 성부와 성자 성령
#   019 전능 왕 오셔서: 19장
#   028 구세주를 아는 이들; 28장          ← 쌍점이 아니라 쌍반점
#   041 시온의 영광이 빛나는 아침(2): 41장  ← 제목 안에 숫자·괄호
#   745 내 주의 크신 은혜: 745            ← 끝에 '장'이 없음
# 뒤쪽 번호를 쓴다(앞뒤가 같고, 뒤가 실제 장 번호다). 구분기호는 마지막 것 기준.
H_TAIL = re.compile(r"^\s*(\d{1,3})\s*\D.*[:;：；]\s*(\d{1,3})\s*장?\s*$")
H_HEAD = re.compile(r"^\s*(\d{1,3})\s*장(?!\s*\d)\s*(.*)$")
YT_ANY = re.compile(r"youtu\.?be|youtube\.com")
ROLE_AT = re.compile(r"(반주|찬양)")


def pdf_text(path):
    """pdftotext 가 있으면 그걸로, 없으면 pypdf 로"""
    try:
        out = os.path.join(tempfile.mkdtemp(), "t.txt")
        subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, out],
                       check=True, capture_output=True)
        with open(out, encoding="utf-8") as f:
            return f.read()
    except Exception:
        pass
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader
        except ImportError:
            sys.exit("PDF를 읽을 도구가 없습니다.  brew install poppler  또는  pip3 install pypdf")
    return "\n".join((p.extract_text() or "") for p in PdfReader(path).pages)


def parse(text):
    """{num: {role: [videoId, …]}}  — 앞에 있는 것이 대표"""
    songs, cur = {}, None
    titles = {}
    broken = []          # 주소인데 영상 ID가 온전치 않은 줄 (PDF에서 잘린 것)
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue

        # 곡 머리줄인가? (주소가 들어 있는 줄은 머리줄이 아니다)
        if not YT.search(line):
            if YT_ANY.search(line):          # 주소인데 ID가 깨진 줄
                broken.append((cur, line[:60]))
                continue
            m = H_TAIL.match(line)
            if m:
                cur = int(m.group(2))
                songs.setdefault(cur, {})
                continue
            m = H_HEAD.match(line)
            if m:
                cur = int(m.group(1))
                songs.setdefault(cur, {})
                titles.setdefault(cur, m.group(2).strip())
                continue
            continue

        if cur is None:
            continue
        # 주소가 있는 줄 — 앞부분에 역할 표기가 있으면 따른다
        head = line[:YT.search(line).start()]
        r = ROLE_AT.search(head)
        role = ("song" if r.group(1) == "찬양" else "mr") if r else "mr"
        for vid in YT.findall(line):
            songs[cur].setdefault(role, [])
            if vid not in songs[cur][role]:
                songs[cur][role].append(vid)
    return songs, titles, broken


def write(path, name, role, items):
    if not items:
        print(f"  · {os.path.basename(path)} — 담을 것이 없어 만들지 않음")
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"name": name, "kind": "youtube", "role": role, "items": items},
                  f, ensure_ascii=False, indent=1)
    print(f"  ✓ {os.path.basename(path)} — {len(items)}곡")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    src = sys.argv[1]
    outdir = sys.argv[2] if len(sys.argv) > 2 else "."
    if not os.path.exists(src):
        sys.exit(f"파일이 없습니다: {src}")

    songs, titles, broken = parse(pdf_text(src))
    if not songs:
        sys.exit("곡을 하나도 찾지 못했습니다. PDF 생김새가 다를 수 있습니다.")

    mr, song, alt = {}, {}, {}
    for n in sorted(songs):
        got = songs[n]
        if got.get("mr"):
            mr[str(n)] = got["mr"][0]
            if len(got["mr"]) > 1:
                alt[str(n)] = got["mr"][1]        # 대표 다음 하나만
        if got.get("song"):
            song[str(n)] = got["song"][0]

    nums = sorted(songs)
    missing = [n for n in range(1, (max(nums) if nums else 0) + 1) if str(n) not in mr and str(n) not in song]
    total_links = sum(len(v) for g in songs.values() for v in g.values())

    print(f"\n📄 {os.path.basename(src)}")
    print(f"   곡 머리줄 {len(songs)}개 · 주소 {total_links}개 (번호 1~{max(nums) if nums else 0})")
    print()
    write(os.path.join(outdir, "찬미가-유튜브-반주.json"), "찬미가 유튜브 · 반주", "mr", mr)
    write(os.path.join(outdir, "찬미가-유튜브-찬양.json"), "찬미가 유튜브 · 찬양", "song", song)
    write(os.path.join(outdir, "찬미가-유튜브-반주-다른연주.json"), "찬미가 유튜브 · 다른 연주", "mr", alt)

    if missing:
        head = ", ".join(str(n) for n in missing[:25])
        print(f"\n  ℹ 링크가 없는 번호 {len(missing)}개: {head}{' …' if len(missing) > 25 else ''}")
    if broken:
        print(f"  ⚠ 주소가 잘려 못 읽은 줄 {len(broken)}개:")
        for n, ln in broken[:8]:
            print(f"      {n}장 — {ln}")
    print("\n다음: 매일찬양 › 찬미가 › 곡 열기 › 🎵 음원 › [표 가져오기] 에서 넣으세요.")
    print("      유튜브는 인터넷이 있을 때만 재생됩니다 — 오프라인은 폴더 쪽을 쓰세요.")


if __name__ == "__main__":
    main()
