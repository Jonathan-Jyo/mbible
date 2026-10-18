package com.jonathan.biblemem;

// ============================================================================
// ZipIndex — 큰 압축파일을 메모리에 올리지 않고 읽는다
// ============================================================================
// 웹 쪽 압축 도구(JSZip)는 압축파일을 통째로 메모리에 올려야 푼다. tojesus 전체는 640MB 라
// 휴대폰에서는 앱이 꺼진다. 여기서는 압축 끝의 「목차」(central directory)만 읽어 이름·크기를
// 알아내고, 한 파일씩 그 자리로 건너가(seek) 조금씩 흘려 읽는다.
//
//  · ZIP64(4GB 넘는 압축·파일)도 읽는다 — 찬미가 반주 7GB 를 한 덩이로 묶을 수도 있다
//  · 이름: 「UTF-8」 표시가 있으면 UTF-8. 없으면 UTF-8 로 풀어 보고(맥 파인더 압축은 표시 없이
//    UTF-8 이다), 안 되면 윈도우 한글(MS949)로. 한글 자모는 다시 붙인다(NFC)
//  · 건너뛰어 읽을 수 없는 자리(구름 폴더의 흘려보내기 등)는 다루지 않는다 — 열 때 알린다
// ============================================================================

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.zip.Inflater;
import java.util.zip.InflaterInputStream;

final class ZipIndex {

    static final class Entry {
        final int index;
        final String name;
        final long size, csize, localOffset;
        final int method;
        final boolean dir;

        Entry(int index, String name, long size, long csize, long localOffset, int method) {
            this.index = index;
            this.name = name;
            this.size = size;
            this.csize = csize;
            this.localOffset = localOffset;
            this.method = method;
            this.dir = name.endsWith("/");
        }
    }

    private static final int SIG_EOCD = 0x06054b50;
    private static final int SIG_Z64_LOC = 0x07064b50;
    private static final int SIG_Z64_EOCD = 0x06064b50;
    private static final int SIG_CEN = 0x02014b50;
    private static final int SIG_LOC = 0x04034b50;
    private static final long U32 = 0xFFFFFFFFL;

    private final FileChannel ch;
    private final List<Entry> entries;

    private ZipIndex(FileChannel ch, List<Entry> entries) {
        this.ch = ch;
        this.entries = entries;
    }

    List<Entry> entries() { return Collections.unmodifiableList(entries); }

    /** 목차를 읽는다. 건너뛰어 읽을 수 없거나 압축이 아니면 IOException */
    static ZipIndex open(FileChannel ch) throws IOException {
        long size;
        try { size = ch.size(); } catch (IOException e) { throw new IOException("건너뛰어 읽을 수 없는 자리입니다", e); }
        if (size < 22) throw new IOException("압축파일이 아닙니다");

        // ── 끝머리(EOCD) 찾기 — 주석이 붙으면 끝에서 최대 64KB 앞까지 밀린다
        int tail = (int) Math.min(size, 22 + 0xFFFF);
        ByteBuffer t = readAt(ch, size - tail, tail);
        int eocd = -1;
        for (int i = tail - 22; i >= 0; i--) {
            if (t.getInt(i) == SIG_EOCD) { eocd = i; break; }
        }
        if (eocd < 0) throw new IOException("압축 목차를 찾지 못했습니다 — 받다 끊겼거나 압축파일이 아닙니다");
        long count = t.getShort(eocd + 10) & 0xFFFF;
        long cdSize = t.getInt(eocd + 12) & U32;
        long cdOff = t.getInt(eocd + 16) & U32;

        // ── ZIP64 — 목차의 값이 넘치면 앞의 ZIP64 끝머리에 진짜 값이 있다
        if (count == 0xFFFF || cdSize == U32 || cdOff == U32) {
            long locPos = size - tail + eocd - 20;
            if (locPos >= 0) {
                ByteBuffer loc = readAt(ch, locPos, 20);
                if (loc.getInt(0) == SIG_Z64_LOC) {
                    long z64 = loc.getLong(8);
                    ByteBuffer z = readAt(ch, z64, 56);
                    if (z.getInt(0) != SIG_Z64_EOCD) throw new IOException("ZIP64 목차가 어긋났습니다");
                    count = z.getLong(32);
                    cdSize = z.getLong(40);
                    cdOff = z.getLong(48);
                }
            }
        }
        if (cdOff + cdSize > size || cdSize > Integer.MAX_VALUE) throw new IOException("목차가 어긋났습니다");

        ByteBuffer cd = readAt(ch, cdOff, (int) cdSize);
        List<Entry> out = new ArrayList<>((int) Math.min(count, 100000));
        int p = 0, idx = 0;
        while (p + 46 <= cd.limit() && cd.getInt(p) == SIG_CEN) {
            int flags = cd.getShort(p + 8) & 0xFFFF;
            int method = cd.getShort(p + 10) & 0xFFFF;
            long csize = cd.getInt(p + 20) & U32;
            long usize = cd.getInt(p + 24) & U32;
            int nLen = cd.getShort(p + 28) & 0xFFFF;
            int xLen = cd.getShort(p + 30) & 0xFFFF;
            int cLen = cd.getShort(p + 32) & 0xFFFF;
            long off = cd.getInt(p + 42) & U32;
            byte[] nb = new byte[nLen];
            cd.position(p + 46);
            cd.get(nb);
            // ZIP64 덧붙임(0x0001) — 넘친 값만 차례로 들어 있다
            int x = p + 46 + nLen, xEnd = x + xLen;
            while (x + 4 <= xEnd) {
                int id = cd.getShort(x) & 0xFFFF, len = cd.getShort(x + 2) & 0xFFFF;
                if (id == 0x0001) {
                    int q = x + 4;
                    if (usize == U32 && q + 8 <= x + 4 + len) { usize = cd.getLong(q); q += 8; }
                    if (csize == U32 && q + 8 <= x + 4 + len) { csize = cd.getLong(q); q += 8; }
                    if (off == U32 && q + 8 <= x + 4 + len) { off = cd.getLong(q); }
                }
                x += 4 + len;
            }
            out.add(new Entry(idx++, decodeName(nb, (flags & 0x800) != 0), usize, csize, off, method));
            p += 46 + nLen + xLen + cLen;
        }
        // 목차가 중간에 깨졌으면(받다 끊긴 압축 등) 뒤쪽 파일이 조용히 빠진다 — 개수가 다르면 멈춘다
        if (count != 0xFFFF && out.size() != count) {
            throw new IOException("압축 목차가 깨졌습니다(" + out.size() + "/" + count + "개만 읽힘) — 압축파일을 다시 받아 주세요");
        }
        return new ZipIndex(ch, out);
    }

    /** 한 파일의 알맹이를 흘려 읽는 통로. 다 읽으면 닫는다(압축파일 자체는 열린 채로) */
    InputStream open(Entry e) throws IOException {
        if (e.dir) throw new IOException("폴더입니다");
        ByteBuffer loc = readAt(ch, e.localOffset, 30);
        if (loc.getInt(0) != SIG_LOC) throw new IOException("파일 머리가 어긋났습니다");
        int nLen = loc.getShort(26) & 0xFFFF, xLen = loc.getShort(28) & 0xFFFF;
        long start = e.localOffset + 30 + nLen + xLen;
        InputStream raw = new Bounded(Channels.newInputStream(ch.position(start)), e.csize);
        if (e.method == 0) return raw;
        if (e.method == 8) {
            final Inflater inf = new Inflater(true);
            return new InflaterInputStream(raw, inf, 1 << 16) {
                @Override public void close() throws IOException {
                    try { super.close(); } finally { inf.end(); }   // 넘겨준 Inflater 는 스스로 닫히지 않는다
                }
            };
        }
        throw new IOException("다룰 수 없는 압축 방식입니다(" + e.method + ")");
    }

    private static ByteBuffer readAt(FileChannel ch, long pos, int len) throws IOException {
        ByteBuffer b = ByteBuffer.allocate(len).order(ByteOrder.LITTLE_ENDIAN);
        while (b.hasRemaining()) {
            int n = ch.read(b, pos + b.position());
            if (n < 0) throw new IOException("압축파일이 잘렸습니다");
        }
        b.flip();
        return b;
    }

    /** 이름 바이트 → 글자. UTF-8 표시 → UTF-8 / 표시 없음 → UTF-8 로 풀리면 UTF-8, 아니면 MS949 */
    static String decodeName(byte[] b, boolean utf8Flag) {
        String s;
        if (utf8Flag) s = new String(b, StandardCharsets.UTF_8);
        else {
            try {
                s = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(b)).toString();
            } catch (CharacterCodingException notUtf8) {
                s = new String(b, korean());
            }
        }
        return Normalizer.normalize(s.replace('\\', '/'), Normalizer.Form.NFC);
    }

    private static Charset korean() {
        for (String n : new String[]{ "MS949", "x-windows-949", "EUC-KR" }) {
            try { return Charset.forName(n); } catch (Exception ignored) { /* 다음 이름으로 */ }
        }
        return StandardCharsets.ISO_8859_1;
    }

    /** 정해진 길이까지만 읽게 막는 통로 — 다음 파일의 알맹이까지 넘어가지 않게 */
    private static final class Bounded extends FilterInputStream {
        private long left;

        Bounded(InputStream in, long len) { super(in); left = len; }

        @Override public int read() throws IOException {
            if (left <= 0) return -1;
            int c = super.read();
            if (c >= 0) left--;
            return c;
        }

        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override public void close() { /* 압축파일 통로는 ZipIndex 를 쓰는 쪽이 닫는다 */ }
    }
}
