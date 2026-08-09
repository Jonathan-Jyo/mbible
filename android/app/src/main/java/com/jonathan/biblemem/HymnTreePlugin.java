package com.jonathan.biblemem;

// ============================================================================
// HymnTree — 폴더 하나를 통째로 앱에 넘겨받는다 (안드로이드 SAF)
// ============================================================================
// 어르신 휴대폰에 7.8GB짜리 음원을 내장 문서 폴더로 복사하게 할 수는 없다.
// SD카드에 둔 채로 읽어야 하는데, Capacitor 기본 Filesystem 은 SD카드를
// 다루지 못하고, 파일을 하나씩 고르는 방식은 삼성 파일 관리자에서 한 번에
// 500개까지만 골라진다. 곡이 3,800개라 애초에 불가능하다.
//
// 그래서 '파일을 고르는' 대신 '폴더를 통째로 넘긴다'.
//  · 한 번 고르면 그 안의 파일은 개수 제한 없이 읽힌다
//  · 권한이 저장되어 앱을 껐다 켜도 다시 고를 필요가 없다
//  · SD카드·내장·USB 어디든 되고, 폴더 이름도 무엇이든 좋다
//  · 복사를 하지 않으므로 내장 공간이 필요 없다
//
// 재생은 content:// 를 Capacitor 가 그대로 흘려보내 준다(Bridge.java 의
// _capacitor_content_). 파일을 통째로 메모리에 올리지 않는다.
// ============================================================================

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "HymnTree")
public class HymnTreePlugin extends Plugin {

    private static final String PREF  = "hymn_tree";

    /** 칸을 나누기 전에는 열쇠가 이것 하나였다. 이미 고른 폴더가 여기 남아 있다. */
    private static final String K_LEGACY = "tree_uri";

    /** 폴더를 여러 개 따로 기억한다 — 찬미가 음원(hymn)과 음악 모으기(music)는 다른 폴더다 */
    private static String key(PluginCall call) {
        String slot = call.getString("slot");
        return "tree_uri_" + ((slot == null || slot.isEmpty()) ? "hymn" : slot);
    }

    /** 칸 이름을 붙이면서 옛 열쇠에 든 폴더가 미아가 됐다. 한 번 옮겨 준다. */
    private void migrateLegacy(PluginCall call) {
        SharedPreferences pf = prefs();
        String slot = call.getString("slot");
        boolean isHymn = (slot == null || slot.isEmpty() || "hymn".equals(slot));
        if (!isHymn) return;                              // 찬미가 칸만 물려받는다
        String legacy = pf.getString(K_LEGACY, null);
        if (legacy == null) return;
        if (pf.getString(key(call), null) == null) {
            pf.edit().putString(key(call), legacy).apply();
        }
        pf.edit().remove(K_LEGACY).apply();
    }

    /** 훑기를 멈추는 깊이. 출처/반주/파일 이면 3단이라 넉넉하다. */
    private static final int MAX_DEPTH = 4;

    /** 잘못 고른 폴더(내려받기 폴더 통째 등)에서 하염없이 도는 것을 막는다. */
    private static final int MAX_FILES = 40000;

    private static final String[] COLS = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE
    };

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    // ── 폴더 고르기 ─────────────────────────────────────────────────────

    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                 | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = (data == null) ? null : data.getData();
        if (uri == null) {                       // 사용자가 취소했다
            call.resolve(new JSObject().put("ok", false));
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) {
            // 권한을 붙들지 못해도 이번 실행 동안은 읽힌다. 다음에 다시 고르면 된다.
        }
        prefs().edit().putString(key(call), uri.toString()).apply();
        call.resolve(new JSObject()
            .put("ok", true)
            .put("uri", uri.toString())
            .put("name", rootName(uri))
            .put("local", isLocal(uri)));
    }

    /** 지난번에 고른 폴더가 아직 읽히는가 */
    @PluginMethod
    public void saved(PluginCall call) {
        Uri uri = savedUri(call);
        if (uri == null) { call.resolve(new JSObject().put("ok", false)); return; }
        call.resolve(new JSObject()
            .put("ok", true)
            .put("uri", uri.toString())
            .put("name", rootName(uri))
            .put("local", isLocal(uri)));
    }

    @PluginMethod
    public void forget(PluginCall call) {
        Uri uri = savedUri(call);
        if (uri != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception e) { }
        }
        prefs().edit().remove(key(call)).apply();
        call.resolve(new JSObject().put("ok", true));
    }

    // ── 폴더 훑기 ───────────────────────────────────────────────────────
    // 고른 폴더를 뿌리로 삼아, 그 아래 모든 소리 파일의 '상대 경로'를 준다.
    //   ["연합회/반주/001.mp3", "연합회/찬양/001.mp3", …]
    // 웹 쪽은 지금 쓰던 그대로 이 경로만 가지고 목록을 만든다.

    @PluginMethod
    public void list(PluginCall call) {
        Uri tree = savedUri(call);
        if (tree == null) { call.reject("고른 폴더가 없습니다"); return; }

        ContentResolver cr = getContext().getContentResolver();
        List<String> out = new ArrayList<>();
        ArrayDeque<String[]> queue = new ArrayDeque<>();   // {문서 id, 상대 경로, 깊이}
        queue.add(new String[]{ DocumentsContract.getTreeDocumentId(tree), "", "0" });

        boolean cut = false, slow = false;
        while (!queue.isEmpty()) {
            String[] job = queue.poll();
            String docId = job[0], rel = job[1];
            int depth = Integer.parseInt(job[2]);

            Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
            Cursor c = null;
            try {
                // 구글 드라이브 같은 구름 폴더는 "일단 아는 것부터" 주고 나머지를 뒤에 보낸다.
                // 첫 응답만 읽으면 757곡이 200곡으로 끊긴다. 다 올 때까지 다시 물어본다.
                for (int t = 0; t < 40; t++) {
                    if (c != null) c.close();
                    c = cr.query(kids, COLS, null, null, null);
                    if (c == null) break;
                    Bundle ex = c.getExtras();
                    if (ex == null || !ex.getBoolean(DocumentsContract.EXTRA_LOADING, false)) break;
                    slow = true;
                    try { Thread.sleep(250); } catch (InterruptedException ie) { break; }
                }
                if (c == null) continue;
                while (c.moveToNext()) {
                    String id   = c.getString(0);
                    String name = c.getString(1);
                    String mime = c.getString(2);
                    if (name == null) continue;
                    String path = rel.isEmpty() ? name : rel + "/" + name;

                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                        if (depth + 1 < MAX_DEPTH) {
                            queue.add(new String[]{ id, path, String.valueOf(depth + 1) });
                        }
                    } else if (isAudio(name)) {
                        if (out.size() >= MAX_FILES) { cut = true; break; }
                        out.add(path);
                    }
                }
            } catch (Exception e) {
                // 못 읽는 칸은 건너뛴다 — 나머지까지 버릴 이유가 없다
            } finally {
                if (c != null) c.close();
            }
            if (cut) break;
        }

        JSArray arr = new JSArray();
        for (String s : out) arr.put(s);
        call.resolve(new JSObject()
            .put("files", arr)
            .put("count", out.size())
            .put("cut", cut)                    // 너무 많아 잘랐으면 알려 준다
            .put("slow", slow)                  // 구름 폴더라 나눠 받았나
            .put("local", isLocal(tree))
            .put("name", rootName(tree)));
    }

    // ── 재생할 주소 만들기 ──────────────────────────────────────────────
    // 상대 경로 하나를 content:// 로 바꿔 준다. 웹은 이것을 그대로
    // Capacitor.convertFileSrc 에 넘겨 <audio src> 로 쓴다.

    @PluginMethod
    public void uri(PluginCall call) {
        String rel = call.getString("rel");
        if (rel == null || rel.isEmpty()) { call.reject("경로가 없습니다"); return; }
        Uri tree = savedUri(call);
        if (tree == null) { call.reject("고른 폴더가 없습니다"); return; }

        String docId = DocumentsContract.getTreeDocumentId(tree) + "/" + rel;
        Uri u = DocumentsContract.buildDocumentUriUsingTree(tree, docId);
        call.resolve(new JSObject().put("uri", u.toString()));
    }

    // ── 자잘한 것들 ─────────────────────────────────────────────────────

    private Uri savedUri(PluginCall call) {
        migrateLegacy(call);
        String s = prefs().getString(key(call), null);
        if (s == null) return null;
        Uri uri = Uri.parse(s);
        // 권한이 아직 살아 있는지 본다. 사용자가 설정에서 거둬 갔을 수 있다.
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && p.isReadPermission()) return uri;
        }
        return null;
    }

    /** 기기 안(내장·SD·USB)의 폴더인가. 구름(드라이브·원드라이브)이면 아니다. */
    private static boolean isLocal(Uri tree) {
        String a = tree.getAuthority();
        return "com.android.externalstorage.documents".equals(a);
    }

    /** 고른 폴더의 이름 — 화면에 "연합회_찬미 폴더를 읽는 중" 처럼 보여 주려고 */
    private String rootName(Uri tree) {
        Cursor c = null;
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(
                tree, DocumentsContract.getTreeDocumentId(tree));
            c = getContext().getContentResolver().query(
                doc, new String[]{ DocumentsContract.Document.COLUMN_DISPLAY_NAME },
                null, null, null);
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception e) {
        } finally {
            if (c != null) c.close();
        }
        return "";
    }

    private static boolean isAudio(String name) {
        String n = name.toLowerCase();
        return n.endsWith(".mp3") || n.endsWith(".m4a") || n.endsWith(".aac")
            || n.endsWith(".ogg") || n.endsWith(".wav") || n.endsWith(".opus");
    }
}
