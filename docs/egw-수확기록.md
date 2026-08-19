# EGW 수확 — 어디까지 왔고, 어떻게 이어받나

**2026-08-19 20:00 에 멈춤.** 대화는 접히므로 이어받는 데 필요한 것을 여기 적는다.

---

## 한 줄로

    한글 53권 완료 · 22,012쪽      영문 33권 완료 · 16,031쪽
    공유 폴더 Gospel_Harmony/EGW/wdb/ 에 87권
    인덱스가 부르는 58종 가운데 영문 25권이 아직 남았다

---

## 이어받는 법

**이 한 줄이면 된다.** 다 받은 책은 건너뛰고, 끊긴 책은 멈춘 자리에서 이어 걷는다.

```bash
bash /tmp/egw_run.sh            # 없으면 아래 「되살리기」 참고
```

`/tmp` 는 재부팅에 지워지므로, 없으면 이렇게 되살린다:

```bash
R=/Users/ipentech/claude_code/Jonathan_CD/성경절암송
E=/Users/ipentech/claude_code/Jonathan_CD/Gospel_Harmony/EGW

# ① 수확 — 한글 먼저 끝내고 영문. **둘을 동시에 돌리지 않는다**
#    동시에 돌리면 6초 간격이 서버에는 3초가 되어, 규칙을 지키면서도 어기는 셈이다
cat > /tmp/egw_run.sh <<'EOF'
#!/usr/bin/env bash
R=/Users/ipentech/claude_code/Jonathan_CD/성경절암송
E=/Users/ipentech/claude_code/Jonathan_CD/Gospel_Harmony/EGW
echo "═══ 한글 이어받기 $(date +%H:%M) ═══"
EGW_LANG=ko python3 -u "$R/scripts/egw_fetch.py" "$E/raw" --fetch
echo; echo "═══ 영문 이어받기 $(date +%H:%M) ═══"
EGW_LANG=en python3 -u "$R/scripts/egw_fetch.py" "$E/raw_en" --fetch
echo "═══ 모두 끝 $(date +%H:%M) ═══"
EOF
chmod +x /tmp/egw_run.sh
nohup /tmp/egw_run.sh > "$E/run.log" 2>&1 &

# ② 받는 대로 한 권씩 공유 폴더로 (열 분마다 · 덮지 않는다)
nohup bash "$R/scripts/egw_relay.sh" "$E/raw"    "$E/build_ko" "$E/wdb" > "$E/relay_ko.log" 2>&1 &
nohup bash "$R/scripts/egw_relay.sh" "$E/raw_en" "$E/build_en" "$E/wdb" > "$E/relay_en.log" 2>&1 &
```

진행 보기 · 적중률 재기:

```bash
python3 scripts/egw_status.py                                   # 어디까지 왔나 + 시간당 몇 쪽
python3 scripts/egw_coverage.py /Users/ipentech/claude_code/Jonathan_CD/Gospel_Harmony/EGW/wdb
```

---

## 남은 것

### 영문 — 아직 손도 안 댄 25권

    화잇주석  1BC 2BC 3BC 4BC 5BC 6BC 7BC        ← 인덱스 8,336줄. 가장 값지다
    증언 계열  TM SR Te WM MM SL ChS EW CM CW
    영문만    FE CH ML SD 2SG 3SG 4aSG LS

### 미완 둘

| | 왜 |
|---|---|
| 영문 `MYP` (청년에게 보내는 기별) | 멈출 때 받던 중. 이어받으면 된다 |
| 한글 `2MCP` (마음과 품성 2) | `MAX_HOPS=900` 한도에 닿음. 다시 돌리면 900걸음 더 걷는다. 인덱스가 안 부르는 책이라 급하지 않다 |

### 아홉 권은 다 끝났다

DA·PP·PK·AA·GC·MB·MH·COL·SC **한글·영문 모두 완료.** 앱에서 영한대역으로 읽힌다.

    DA 717/717 · PP 676/685 · PK 663/668 · AA 585/587 · GC 666/675
    MB 151/151 · MH 475/478 · COL 371/370 · SC 108/110

---

## 지킬 것 (실패로 배운 것들)

- **걸음 6초 · 책 사이 30초.** 1.7초로 서두르다 서른여섯 권 중 서른 권을 잃었다
- **503 이면 60→180→600→1800초 물러섰다 같은 자리에서 다시.** 4초로는 모자란다
- **둘이 동시에 두드리지 않는다.** 형제앱은 수확에서 물러서 있다(합의)
- **날것을 먼저 굳힌다.** 규칙을 고칠 때마다 다시 긁으면 남의 서버를 여러 번 읽는다
- **책 번호를 짐작하지 않는다.** 첫 걸음에서 `refcode` 로 확인한다.
  대쟁투는 목록에 둘이고 `133` 은 1888년판, 우리 것은 `132` 다
- **공유 폴더는 `egw_share.py` 로만 올린다.** 통째 복사로 형제앱 편집본을 덮은 적이 있다

---

## 자리

    Gospel_Harmony/EGW/raw/        한글 날것
    Gospel_Harmony/EGW/raw_en/     영문 날것
    Gospel_Harmony/EGW/wdb/        공유 폴더 — 완성본 87권
    Gospel_Harmony/EGW/wdb/초판_epub/   epub 유래(초판본). 서버본으로 갈아탔다

바탕화면은 쓰지 않는다 — 접근이 막혀 있고 APK 빌드 때만 쓴다.

---

## 함께 볼 것

- [egw-남은일.md](egw-남은일.md) — 표지에 코드가 없어 건너뛴 책 셋, 2MCP 한도
- `Gospel_Harmony/EGW/wdb/서문의심-한글54권.md` — 앞붙이 의심 20권 (형제앱이 편집기로 지운다)
