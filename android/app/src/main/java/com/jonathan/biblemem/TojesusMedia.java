package com.jonathan.biblemem;

// ============================================================================
// TojesusMedia — tojesus 폴더의 오디오를 재생 엔진에 흘려보낸다 (복사하지 않는다)
// ============================================================================
// 성경 오디오·예언의신 오디오·설교는 수 GB 라 앱 안에 담지 않는다. 재생 엔진(player.html)이
//   <audio src="/_tojesus_/audiobible/개역한글/01_창세기/001.mp3">
// 처럼 부르면, 여기서 그 파일을 tojesus 연결(TojesusFolderPlugin 이 기억한 자리)에서 열어 넘긴다.
//
//  · 건너뛰기(Range: bytes=…) 를 받는다 — 한 시간짜리 설교의 중간으로 바로 간다. 통째로 읽지 않는다
//  · Capacitor 의 content:// 다리(convertFileSrc)는 삼성 태블릿에서 알맹이가 오지 않았다(찬미가 실측).
//    크기·범위를 우리가 직접 적어 넘기므로 그 다리를 쓰지 않는다
//  · tojesus 밖으로 나가는 경로(..)는 막고, 읽기만 한다
// ============================================================================

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class TojesusMedia {

    private TojesusMedia() {}

    static final String PREFIX = "/_tojesus_/";
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");

    /** 우리 주소면 응답을, 아니면 null(다른 길에 맡긴다) */
    static WebResourceResponse serve(Context c, WebResourceRequest req) {
        String path = req.getUrl().getEncodedPath();
        if (path == null || !path.startsWith(PREFIX)) return null;
        StringBuilder rel = new StringBuilder();
        for (String seg : path.substring(PREFIX.length()).split("/")) {
            String s = Uri.decode(seg);
            // 풀린 조각 안에 / 가 있으면(%2F) 「..」 검사를 비켜 간다 — 그런 조각은 아예 받지 않는다
            if (s.isEmpty() || s.equals(".") || s.equals("..") || s.indexOf('/') >= 0 || s.indexOf('\\') >= 0 || s.indexOf('\0') >= 0) return fail(400, "Bad Request");
            if (rel.length() > 0) rel.append('/');
            rel.append(s);
        }
        SharedPreferences p = c.getSharedPreferences("tojesus_folder", 0);
        String tree = p.getString("tree", null), root = p.getString("root", null);
        if (tree == null || root == null || rel.length() == 0) return fail(404, "Not Found");

        Uri doc = DocumentsContract.buildDocumentUriUsingTree(Uri.parse(tree), root + "/" + rel);
        ParcelFileDescriptor pfd = null;
        try {
            pfd = c.getContentResolver().openFileDescriptor(doc, "r");
            if (pfd == null) return fail(404, "Not Found");
            long size = pfd.getStatSize();
            long start = 0, end = size - 1;
            boolean partial = false;
            String range = header(req, "Range");
            if (range != null && size > 0) {
                Matcher m = RANGE.matcher(range.trim());
                if (m.matches() && m.group(1).length() <= 18 && m.group(2).length() <= 18) {   // 터무니없는 숫자는 범위 없이 통째로
                    if (!m.group(1).isEmpty()) {
                        start = Long.parseLong(m.group(1));
                        if (!m.group(2).isEmpty()) end = Math.min(Long.parseLong(m.group(2)), size - 1);
                    } else if (!m.group(2).isEmpty()) {          // bytes=-500 — 끝에서 500바이트
                        start = Math.max(0, size - Long.parseLong(m.group(2)));
                    }
                    if (start > end || start >= size) {
                        pfd.close();
                        Map<String, String> h = new HashMap<>();
                        h.put("Content-Range", "bytes */" + size);
                        return new WebResourceResponse(mime(rel.toString()), null, 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0]));
                    }
                    partial = true;
                }
            }
            FileInputStream fis = new ParcelFileDescriptor.AutoCloseInputStream(pfd);
            pfd = null;   // 이제 fis 가 닫는다
            if (start > 0) {
                try { fis.getChannel().position(start); }
                catch (Exception e) { try { fis.close(); } catch (IOException ignored) { /* 닫기 실패는 할 일이 없다 */ } return fail(416, "Range Not Satisfiable"); }
            }
            long len = size >= 0 ? end - start + 1 : -1;
            Map<String, String> h = new HashMap<>();
            if (size >= 0) h.put("Accept-Ranges", "bytes");   // 크기를 모르면 건너뛰기를 약속하지 않는다
            h.put("Cache-Control", "no-store");
            if (len >= 0) h.put("Content-Length", String.valueOf(len));
            if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            InputStream body = len >= 0 ? new Bounded(fis, len) : fis;
            return new WebResourceResponse(mime(rel.toString()), null, partial ? 206 : 200, partial ? "Partial Content" : "OK", h, body);
        } catch (Exception e) {
            if (pfd != null) { try { pfd.close(); } catch (IOException ignored) { /* 닫기 실패는 할 일이 없다 */ } }
            return fail(404, "Not Found");
        }
    }

    private static String header(WebResourceRequest req, String name) {
        Map<String, String> h = req.getRequestHeaders();
        if (h == null) return null;
        for (Map.Entry<String, String> e : h.entrySet()) if (name.equalsIgnoreCase(e.getKey())) return e.getValue();
        return null;
    }

    private static String mime(String rel) {
        String n = rel.toLowerCase(Locale.ROOT);
        if (n.endsWith(".mp3")) return "audio/mpeg";
        if (n.endsWith(".m4a") || n.endsWith(".aac") || n.endsWith(".m4b")) return "audio/mp4";
        if (n.endsWith(".ogg") || n.endsWith(".opus")) return "audio/ogg";
        if (n.endsWith(".wav")) return "audio/wav";
        if (n.endsWith(".flac")) return "audio/flac";
        return "application/octet-stream";
    }

    private static WebResourceResponse fail(int code, String why) {
        return new WebResourceResponse("text/plain", "utf-8", code, why, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    /** 범위만큼만 읽게 막는 통로 */
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

        @Override public int available() throws IOException { return (int) Math.min(super.available(), left); }

        @Override public long skip(long n) throws IOException {
            long k = super.skip(Math.min(n, left));
            if (k > 0) left -= k;
            return k;
        }
    }
}
