#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
찬미가 음원 내려받기 — 앱의 '항상예수께로_찬미' 폴더를 만들어 준다.

  받는 곳 : adventist.or.kr 찬미가 플레이어가 쓰는 공개 S3
  만드는 것:
      항상예수께로_찬미/
      ├ 반주/  001.mp3 · 444.mp3 · 444_pitch_-2_tempo_0_pitched.mp3 …
      └ 찬양/  013.mp3 …
  이 폴더를 휴대폰 문서(Documents) 안에 그대로 옮기면 앱이 바로 읽는다.
  (매일찬양 › 찬미가 › 곡 열기 › 🎵 음원 › [폴더 읽기])

── 쓰는 법 ──────────────────────────────────────────────────────────
  python3 get-hymn-audio.py 1-50                 1~50장 반주
  python3 get-hymn-audio.py 444 305 12           고른 곡만
  python3 get-hymn-audio.py 1-759 --song         찬양 음원도 함께
  python3 get-hymn-audio.py 300-320 --pitch=-2,-1,1  음정 다른 것도
                                                 (음수라서 = 로 붙여 씁니다)
  python3 get-hymn-audio.py --list               무엇이 있는지만 보기
  python3 get-hymn-audio.py 1-100 --dry-run      받지 않고 계획만

── 알아 둘 것 ───────────────────────────────────────────────────────
  · 한 곡씩 천천히 받는다(기본 0.5초 쉼). 남의 서버이므로 몰아치지 않는다
  · 이미 받은 파일은 건너뛴다 — 중간에 끊겨도 다시 돌리면 이어진다
  · 곡당 약 3MB. 759곡 전부면 2GB가 넘는다. 부르는 곡만 골라 받기를 권한다
  · 음정 변형은 곡당 파일이 6개 더 늘어난다(-3…+3). 꼭 필요한 곡에만
  · 박자는 앱이 스스로 조절하므로 박자 변형은 받지 않는다
  · 이 음원은 한국연합회가 사역용으로 올려 둔 것이다. 많은 양을 받을
    계획이면 미리 한번 여쭙는 편이 서로 마음 편하다
"""

import argparse, json, os, re, sys, time, urllib.error, urllib.request

S3       = "https://adventist.s3.ap-northeast-2.amazonaws.com/"
MR_URL   = S3 + "hymn_mp3/"
SONG_URL = S3 + "hymn_song_mp3/"
DATA_URL = "https://www.adventist.or.kr/hymn_pc/js/hymn-data.json"

OUT_ROOT = "항상예수께로_찬미"
SUB      = {"mr": "반주", "song": "찬양"}
PITCH_OK = (-3, -2, -1, 1, 2, 3)          # 서버에 실제로 있는 범위
UA       = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")


def parse_numbers(tokens):
    """'1-50' '444' '3,7' 를 번호 집합으로"""
    out = set()
    for tok in tokens:
        for part in str(tok).split(","):
            part = part.strip()
            if not part:
                continue
            m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", part)
            if m:
                a, b = int(m.group(1)), int(m.group(2))
                out.update(range(min(a, b), max(a, b) + 1))
            elif part.isdigit():
                out.add(int(part))
            else:
                sys.exit(f"번호를 알아볼 수 없습니다: {part}")
    return sorted(out)


def _read_index(data):
    mr = {int(k) for k, v in data.items() if "accompaniment" in (v.get("availableAudio") or [])}
    song = {int(k) for k, v in data.items() if "song" in (v.get("availableAudio") or [])}
    titles = {int(k): v.get("title", "") for k, v in data.items()}
    return mr, song, titles


def fetch_index(path=None):
    """어느 곡에 반주·찬양이 있는지.

    사이트 쪽은 스크립트 접근을 막아 두어(Cloudflare) 대개 받아지지 않는다.
    그래도 없으면 없는 대로 괜찮다 — 서버에 없는 파일은 받을 때 걸러진다.
    미리 알고 싶으면 브라우저에서 아래 주소를 열어 저장한 뒤 --data 로 넘긴다.
      https://www.adventist.or.kr/hymn_pc/js/hymn-data.json
    """
    if path:
        try:
            with open(path, encoding="utf-8") as f:
                return _read_index(json.load(f))
        except Exception as e:
            sys.exit(f"--data 파일을 읽지 못했습니다: {e}")
    try:
        req = urllib.request.Request(DATA_URL, headers={
            "User-Agent": UA, "Accept": "*/*",
            "Referer": "https://www.adventist.or.kr/hymn_pc/"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return _read_index(json.load(r))
    except Exception:
        print("  ℹ 곡 목록은 못 받았습니다(사이트가 스크립트 접근을 막습니다).")
        print("    그냥 받아 보고 서버에 없는 것은 건너뜁니다 — 결과는 같습니다.")
        print("    미리 알고 싶으면 브라우저에서 hymn-data.json 을 저장해 --data 로 주세요.")
        return None, None, {}


def download(url, path, retries=2):
    """받으면 True, 서버에 없으면 False. 실패는 예외."""
    tmp = path + ".part"
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
            os.replace(tmp, path)
            return True
        except urllib.error.HTTPError as e:
            if os.path.exists(tmp):
                os.remove(tmp)
            if e.code in (403, 404):
                return False                      # 그 파일은 없는 것
            if attempt == retries:
                raise
        except Exception:
            if os.path.exists(tmp):
                os.remove(tmp)
            if attempt == retries:
                raise
        time.sleep(1.5 * (attempt + 1))
    return False


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("numbers", nargs="*", help="1-50 / 444 / 3,7")
    ap.add_argument("--song", action="store_true", help="찬양(함께 부르는) 음원도 받기")
    ap.add_argument("--no-mr", action="store_true", help="반주는 받지 않기")
    ap.add_argument("--pitch", default="", help="음정 변형도 받기 (예: --pitch=-2,-1,1)")
    ap.add_argument("--out", default=OUT_ROOT, help="만들 폴더 (기본: 항상예수께로_찬미)")
    ap.add_argument("--delay", type=float, default=0.5, help="한 파일 받고 쉬는 시간(초)")
    ap.add_argument("--dry-run", action="store_true", help="받지 않고 계획만 보기")
    ap.add_argument("--data", default="", help="브라우저로 저장한 hymn-data.json 경로")
    ap.add_argument("--list", action="store_true", help="무엇이 있는지만 보기")
    ap.add_argument("-h", "--help", action="store_true")
    a = ap.parse_args()

    if a.help or (not a.numbers and not a.list):
        print(__doc__)
        return

    mr_have, song_have, titles = fetch_index(a.data or None)

    if a.list:
        if not titles:
            print("\n목록을 받지 못해 보여 드릴 것이 없습니다. --data 로 파일을 주세요.")
            return
        print(f"\n전체 {len(titles)}곡 · 반주 {len(mr_have or [])}곡 · 찬양 {len(song_have or [])}곡")
        print(f"음정 변형: {', '.join(str(p) for p in PITCH_OK)} (0은 원곡)")
        if song_have:
            s = sorted(song_have)
            print(f"\n찬양이 있는 곡 {len(s)}개:\n  " +
                  ", ".join(str(n) for n in s[:60]) + (" …" if len(s) > 60 else ""))
        return

    nums = parse_numbers(a.numbers)
    pitches = [int(p) for p in re.split(r"[,\s]+", a.pitch) if p.strip()] if a.pitch else []
    bad = [p for p in pitches if p not in PITCH_OK]
    if bad:
        sys.exit(f"음정은 {PITCH_OK} 중에서만 됩니다 (받은 값: {bad})")

    roles = []
    if not a.no_mr:
        roles.append("mr")
    if a.song:
        roles.append("song")
    if not roles:
        sys.exit("받을 것이 없습니다 (--no-mr 과 --song 을 함께 보세요)")

    # ── 받을 목록 만들기 ──
    jobs = []
    for n in nums:
        for role in roles:
            have = mr_have if role == "mr" else song_have
            if have is not None and n not in have:
                continue                                  # 그 곡엔 그 음원이 없다
            base = MR_URL if role == "mr" else SONG_URL
            pad = f"{n:03d}"
            jobs.append((role, n, f"{base}{pad}.mp3", f"{pad}.mp3"))
            if role == "mr":
                for p in pitches:
                    fn = f"{pad}_pitch_{p}_tempo_0_pitched.mp3"
                    jobs.append((role, n, base + fn, fn))

    if not jobs:
        print("받을 파일이 없습니다. 번호를 확인해 주세요.")
        return

    root = os.path.abspath(a.out)
    for role in roles:
        os.makedirs(os.path.join(root, SUB[role]), exist_ok=True)

    todo = [j for j in jobs if not os.path.exists(os.path.join(root, SUB[j[0]], j[3]))]
    print(f"\n📁 {root}")
    print(f"   곡 {len(nums)}개 · 받을 파일 {len(jobs)}개 (이미 있는 것 {len(jobs) - len(todo)}개는 건너뜀)")
    print(f"   대략 {len(todo) * 3 / 1024:.1f}GB 예상 · 쉬는 시간 {a.delay}초\n")

    if a.dry_run:
        for role, n, url, fn in todo[:40]:
            print(f"   {SUB[role]}/{fn}")
        if len(todo) > 40:
            print(f"   … 그 밖 {len(todo) - 40}개")
        return
    if len(todo) > 300:
        ans = input(f"파일 {len(todo)}개를 받습니다. 계속할까요? [y/N] ").strip().lower()
        if ans != "y":
            print("그만둡니다.")
            return

    ok = skip = miss = fail = 0
    t0 = time.time()
    for i, (role, n, url, fn) in enumerate(jobs, 1):
        path = os.path.join(root, SUB[role], fn)
        if os.path.exists(path):
            skip += 1
            continue
        label = f"[{i}/{len(jobs)}] {SUB[role]} {n}장 {titles.get(n,'')}".rstrip()
        print(f"{label} … ", end="", flush=True)
        try:
            if download(url, path):
                ok += 1
                print(f"✓ {os.path.getsize(path)/1048576:.1f}MB")
            else:
                miss += 1
                print("— 없음")
        except KeyboardInterrupt:
            print("\n\n중단했습니다. 다시 돌리면 받던 곳부터 이어집니다.")
            break
        except Exception as e:
            fail += 1
            print(f"✗ {e}")
        time.sleep(a.delay)

    print(f"\n끝났습니다 — 받음 {ok} · 건너뜀 {skip} · 서버에 없음 {miss} · 실패 {fail}"
          f" · {time.time()-t0:.0f}초")
    print(f"\n다음: 「{os.path.basename(root)}」 폴더를 휴대폰 문서(Documents) 안에 넣고,")
    print("      매일찬양 › 찬미가 › 곡 열기 › 🎵 음원 › [폴더 읽기]")


if __name__ == "__main__":
    main()
