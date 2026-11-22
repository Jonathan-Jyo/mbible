package com.jonathan.biblemem;

// ============================================================================
// TojesusFolder — 자료 폴더 tojesus/ 하나를 앱에 연결한다 (읽기·쓰기)
// ============================================================================
// 설계: docs/tojesus-자료폴더-설계.md (11항 — 자동 찾기, v5.29.0)
//
// 길은 둘이다(연결 정보는 TojesusLink 한 곳).
//   auto    「모든 파일 접근」을 허락받아 내장·SD카드 맨 위의 tojesus 를 알아서 찾는다 — 기본
//   picked  사람이 폴더를 고른다(SAF) — 「다른 폴더 고르기」. 고른 것이 있으면 이것이 먼저
// 아래 손발은 모두 두 길을 다 안다 — 파일 길(java.io.File)과 SAF 길을 여기서 고른다.
//
//   allFilesStatus() · requestAllFiles()   모든 파일 접근 허락 보기 · 설정 창 열기(10 이하는 권한 창)
//   findDefault({ create? })    저장소 뿌리마다 tojesus 를 찾아 자동 연결 — create 면 없을 때 내장에 만든다
//   pick()                      폴더 고르기 — tojesus 를 고르거나, 그 위 폴더를 고르면 안에서 찾거나 만든다
//   status()                    { linked, ok, way, writable, sd, where, path, tree, root, allFiles, picked, auto }
//   forget({ picked? })         picked 면 고른 것만 놓는다(자동으로 돌아간다), 아니면 둘 다
//   ensureDirs({ names, marker })   빠진 구역 폴더를 만들고 표지(tojesus.json)를 쓴다
//   scan({ sub? })              { files:[{ path, size, mtime }], cut } — sub 를 주면 그 구역만
//   openRead/readNext/closeRead 조각 읽기(1MB) — 자료 파일을 앱 안으로 옮길 때
//   pickZip()                   압축파일 고르기(여럿) → { files:[{ uri, name, size }] }
//   zipList({ uri | rel })      압축 목차 — { entries:[{ i, name, size, dir }] }
//   zipExtract({ uri | rel, items:[{ i, dest }] })   tojesus 안의 dest 경로로 흘려 풀기
//                               진행은 "zipProgress" { done, total, name, bytes, totalBytes } 로 알린다
//   cancelExtract()
//   deleteDoc({ uri | rel })    다 푼 압축 원본 지우기(사람이 고른 뒤)
//   praiseCopy · praiseWriteBegin/Chunk/End/Abort   매일찬양 [모으기] — tojesus/praise/<앨범>/ 으로 (v5.30.0)
//                               임시 이름(….praise-part)에 쓰고 다 쓴 뒤 이름을 바꾼다 · praiseDropPart({ rel }) 남은 임시 파일 치우기 (v5.31.1)
// ============================================================================

import android.Manifest;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(
    name = "TojesusFolder",
    permissions = {
        // 안드로이드 10 이하에서만 묻는다 — 11+ 는 「모든 파일 접근」 설정 창
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class TojesusFolderPlugin extends Plugin {

    private static final String K_TREE = TojesusLink.K_TREE, K_ROOT = TojesusLink.K_ROOT, K_AUTO = TojesusLink.K_AUTO;
    private static final String ROOT_NAME = TojesusLink.ROOT_NAME;
    private static final String EXT_AUTH = "com.android.externalstorage.documents";
    private static final String MIME_DIR = DocumentsContract.Document.MIME_TYPE_DIR;
    /** 이름을 그대로 두게 하는 종류 — 다른 종류로 만들면 제공자가 확장자를 덧붙이기도 한다 */
    private static final String MIME_BIN = "application/octet-stream";
    private static final int MAX_DEPTH = 8;
    private static final int MAX_FILES = 60000;
    private static final int MAX_CHUNK = 4 << 20;
    private static final String READ_ONLY_MSG = "이 기기(안드로이드 10 이하)에서는 SD카드의 tojesus 에 앱이 바로 쓸 수 없습니다.\n\n"
        + "⚙ 파일관리 › 「다른 폴더 고르기」로 그 tojesus 를 한 번 골라 주세요 — 고른 폴더에는 쓸 수 있습니다.";

    private static final String[] COLS = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED
    };

    private final Map<Integer, InputStream> streams = new ConcurrentHashMap<>();
    private final AtomicInteger nextHandle = new AtomicInteger(1);
    private final AtomicBoolean cancel = new AtomicBoolean(false);
    private final AtomicBoolean extracting = new AtomicBoolean(false);

    private SharedPreferences prefs() { return TojesusLink.prefs(getContext()); }
    private ContentResolver cr() { return getContext().getContentResolver(); }

    /** 지금 쓸 길 — 파일 길이면 그 뿌리, SAF 길이면 null (둘 다 없으면 NoLink) */
    private File fileRoot() throws NoLink {
        String way = TojesusLink.way(getContext());
        if (way == null) throw new NoLink();
        return "auto".equals(way) ? TojesusLink.autoRoot(getContext()) : null;
    }

    private static final class NoLink extends Exception {
        NoLink() { super("tojesus 폴더가 연결되어 있지 않습니다"); }
    }

    // ── 모든 파일 접근(자동 찾기의 열쇠) ────────────────────────────────

    @PluginMethod
    public void allFilesStatus(PluginCall call) {
        call.resolve(new JSObject().put("granted", TojesusLink.allFiles(getContext()))
            .put("how", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? "settings" : "permission"));
    }

    @PluginMethod
    public void requestAllFiles(PluginCall call) {
        if (TojesusLink.allFiles(getContext()) && TojesusLink.allFilesWrite(getContext())) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {   // 10 이하 — 보통의 권한 창
            requestPermissionForAlias("storage", call, "storageBack");
            return;
        }
        // resolveActivity 로 미리 묻지 않는다 — 11+ 는 패키지 가시성 때문에 있는 창도 없다고 답할 수 있다
        try {
            startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName())), "allFilesBack");
        } catch (Exception e) {
            try { startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), "allFilesBack"); }   // 앱 하나만 여는 창이 없는 기기 — 목록 창
            catch (Exception e2) { call.reject("설정 창을 열지 못했습니다: " + e2.getMessage()); }
        }
    }

    @ActivityCallback
    private void allFilesBack(PluginCall call, ActivityResult result) {
        if (call == null) return;
        call.resolve(new JSObject().put("granted", TojesusLink.allFiles(getContext())));
    }

    @PermissionCallback
    private void storageBack(PluginCall call) {
        if (call == null) return;
        call.resolve(new JSObject().put("granted", TojesusLink.allFiles(getContext())));
    }

    /** 저장소 뿌리마다 tojesus 를 찾는다 — 내장 먼저. 찾으면 자동 연결로 기억한다 */
    @PluginMethod
    public void findDefault(PluginCall call) {
        if (!TojesusLink.allFiles(getContext())) { call.reject("모든 파일 접근 허락이 없습니다", "NO_ACCESS"); return; }
        List<File> vols = TojesusLink.volumeRoots(getContext());
        File found = null;
        for (File v : vols) { found = TojesusLink.findIn(v); if (found != null) break; }
        if (found == null && call.getBoolean("create", false) && !vols.isEmpty()) {
            File made = new File(vols.get(0), ROOT_NAME);
            if (made.mkdirs() || made.isDirectory()) found = made;
            else { call.reject("내장 저장소에 tojesus 폴더를 만들지 못했습니다"); return; }
        }
        if (found == null) {
            JSArray roots = new JSArray();
            for (File v : vols) roots.put(v.getAbsolutePath());
            call.resolve(statusObj().put("found", false).put("roots", roots));
            return;
        }
        prefs().edit().putString(K_AUTO, found.getAbsolutePath()).apply();
        call.resolve(statusObj().put("found", true));
    }

    // ── 고르기(SAF) ───────────────────────────────────────────────────────

    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                 | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        // 고르는 창을 저장소 맨 위에서 연다(안드로이드 8+) — 「새 폴더 → tojesus」를 바로 만들 수 있게
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri(EXT_AUTH, "primary:"));
        }
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri tree = data == null ? null : data.getData();
        if (tree == null) { call.resolve(new JSObject().put("ok", false)); return; }
        // 경로를 이어 붙여 파일을 찾는 방식이라 기기 안 저장소(내장·SD카드)만 된다 — 구름 폴더는 미리 거른다
        if (!EXT_AUTH.equals(tree.getAuthority())) {
            call.reject("기기 안(내장 저장소·SD카드)의 폴더를 골라 주세요 — 구글 드라이브 같은 구름 폴더는 쓸 수 없습니다");
            return;
        }
        try {
            cr().takePersistableUriPermission(tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            call.reject("이 폴더는 쓰기 허락을 받을 수 없습니다 — 기기 안(내장·SD카드)의 폴더를 골라 주세요");
            return;
        }
        try {
            String top = DocumentsContract.getTreeDocumentId(tree);
            String root;
            if (ROOT_NAME.equalsIgnoreCase(nameOf(tree, top))) root = top;
            else {
                // 그 위 폴더를 골랐다 — 안에서 tojesus 를 찾고, 없으면 만든다
                Map<String, String[]> kids = children(tree, top);
                String[] found = null;
                for (Map.Entry<String, String[]> k : kids.entrySet()) {
                    if (ROOT_NAME.equalsIgnoreCase(k.getKey()) && MIME_DIR.equals(k.getValue()[1])) { found = k.getValue(); break; }
                }
                if (found != null) root = found[0];
                else {
                    Uri made = DocumentsContract.createDocument(cr(),
                        DocumentsContract.buildDocumentUriUsingTree(tree, top), MIME_DIR, ROOT_NAME);
                    if (made == null) throw new IOException("tojesus 폴더를 만들지 못했습니다");
                    root = DocumentsContract.getDocumentId(made);
                }
            }
            String old = prefs().getString(K_TREE, null);
            if (old != null && !old.equals(tree.toString())) releaseTree(old);   // 다른 자리로 옮겼다 — 옛 권한은 놓아 준다(권한 수에 한도가 있다)
            prefs().edit().putString(K_TREE, tree.toString()).putString(K_ROOT, root).apply();
            call.resolve(statusObj().put("ok", true));
        } catch (Exception e) {
            call.reject("폴더를 연결하지 못했습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(statusObj()); }

    @PluginMethod
    public void forget(PluginCall call) {
        String t = prefs().getString(K_TREE, null);
        if (t != null) releaseTree(t);
        SharedPreferences.Editor ed = prefs().edit().remove(K_TREE).remove(K_ROOT);
        if (!call.getBoolean("picked", false)) ed.remove(K_AUTO);   // 고른 것만 놓으면 자동 연결로 돌아간다
        ed.apply();
        call.resolve(new JSObject().put("ok", true));
    }

    private void releaseTree(String t) {
        try {
            cr().releasePersistableUriPermission(Uri.parse(t),
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) { /* 이미 거둬졌다 */ }
    }

    /** 연결 상태 — 고른 폴더가 닿으면 그것, 아니면 자동으로 찾은 것 */
    private JSObject statusObj() {
        boolean allFiles = TojesusLink.allFiles(getContext());
        String t = prefs().getString(K_TREE, null), root = prefs().getString(K_ROOT, null);
        String autoPath = prefs().getString(K_AUTO, null);
        JSObject o = new JSObject().put("allFiles", allFiles).put("picked", t != null && root != null)
            .put("auto", autoPath != null).put("linked", (t != null && root != null) || autoPath != null);
        boolean pickedOk = TojesusLink.pickedTree(getContext()) != null, write = false;   // 다른 손발과 같은 판정
        if (pickedOk) {
            Uri tree = Uri.parse(t);
            for (UriPermission p : cr().getPersistedUriPermissions()) if (p.getUri().equals(tree)) write = p.isWritePermission();
        }
        if (pickedOk) {
            boolean sd = !root.startsWith("primary:");
            String rel = root.contains(":") ? root.substring(root.indexOf(':') + 1) : root;
            return o.put("ok", true).put("way", "picked").put("writable", write).put("sd", sd)
                .put("where", sd ? "SD카드" : "내장 저장소").put("path", rel).put("tree", t).put("root", root);
        }
        File auto = TojesusLink.autoRoot(getContext());
        if (auto != null) {
            String where = TojesusLink.whereOf(getContext(), auto);
            return o.put("ok", true).put("way", "auto").put("writable", TojesusLink.canWrite(getContext(), auto))
                .put("sd", "SD카드".equals(where)).put("where", where).put("path", auto.getName())
                .put("tree", TojesusLink.FILE_TAG + auto.getAbsolutePath()).put("root", "").put("abs", auto.getAbsolutePath());
        }
        // 기억은 있으나 닿지 않는다 — 고른 폴더의 정보를 그대로 알린다(다시 고르기 안내)
        o.put("ok", false);
        if (t != null && root != null) o.put("way", "picked").put("tree", t).put("root", root);
        else if (autoPath != null) o.put("way", "auto").put("abs", autoPath);
        return o;
    }

    private String rootId() { return TojesusLink.pickedRoot(getContext()); }

    // ── 폴더 만들기 · 훑기 ───────────────────────────────────────────────

    @PluginMethod
    public void ensureDirs(PluginCall call) {
        try {
            File fr = fileRoot();
            JSONArray names = call.getData().optJSONArray("names");
            String marker = call.getString("marker");
            JSArray made = new JSArray();
            if (fr != null && !TojesusLink.canWrite(getContext(), fr)) {
                // 안드로이드 10 이하 SD카드 — 만들 수 없다. 재등록(읽기)은 막지 않고 「못 씀」만 알린다
                call.resolve(new JSObject().put("made", made).put("readOnly", true));
                return;
            }
            if (fr != null) {
                for (int i = 0; names != null && i < names.length(); i++) {
                    String n = names.optString(i, "");
                    if (!TojesusLink.safeSeg(n)) continue;
                    File d = new File(fr, n);
                    if (!d.exists() && d.mkdirs()) made.put(n);
                }
                File mk = new File(fr, "tojesus.json");
                if (marker != null && !mk.exists()) {
                    try (OutputStream out = new FileOutputStream(mk)) { out.write(marker.getBytes(StandardCharsets.UTF_8)); }
                }
                call.resolve(new JSObject().put("made", made));
                return;
            }
            Uri tree = TojesusLink.pickedTree(getContext());
            String root = rootId();
            Map<String, String[]> kids = children(tree, root);
            for (int i = 0; names != null && i < names.length(); i++) {
                String n = names.optString(i, "");
                if (!TojesusLink.safeSeg(n) || kids.containsKey(n)) continue;
                Uri u = DocumentsContract.createDocument(cr(), DocumentsContract.buildDocumentUriUsingTree(tree, root), MIME_DIR, n);
                if (u != null) made.put(n);
            }
            if (marker != null && !kids.containsKey("tojesus.json")) {
                Uri u = DocumentsContract.createDocument(cr(), DocumentsContract.buildDocumentUriUsingTree(tree, root), MIME_BIN, "tojesus.json");
                if (u != null) {
                    try (OutputStream out = cr().openOutputStream(u, "w")) {
                        if (out != null) out.write(marker.getBytes(StandardCharsets.UTF_8));
                    }
                }
            }
            call.resolve(new JSObject().put("made", made));
        } catch (NoLink e) {
            call.reject(e.getMessage());
        } catch (Exception e) {
            call.reject("폴더를 만들지 못했습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void scan(PluginCall call) {
        // sub: 한 구역만 훑는다(예: "audiobible") — 경로는 그래도 tojesus 기준으로 돌려준다
        String sub = call.getString("sub");
        if (sub != null && !sub.isEmpty() && !TojesusLink.safeRel(sub)) { call.reject("경로가 올바르지 않습니다"); return; }
        boolean hasSub = sub != null && !sub.isEmpty();
        File fr;
        try { fr = fileRoot(); } catch (NoLink e) { call.reject(e.getMessage()); return; }
        if (fr != null) { call.resolve(scanFiles(fr, hasSub ? sub : "")); return; }
        Uri tree = TojesusLink.pickedTree(getContext());
        String root = rootId();
        JSArray files = new JSArray();
        int count = 0;
        boolean cut = false;
        ArrayDeque<String[]> queue = new ArrayDeque<>();   // { 문서 id, 상대 경로, 깊이 }
        queue.add(new String[]{ hasSub ? root + "/" + sub : root, hasSub ? sub : "", "0" });
        while (!queue.isEmpty() && !cut) {
            String[] job = queue.poll();
            int depth = Integer.parseInt(job[2]);
            try (Cursor c = cr().query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, job[0]), COLS, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    String name = c.getString(1);
                    if (name == null || name.startsWith(".")) continue;      // 숨은 파일·맥 찌꺼기
                    String path = job[1].isEmpty() ? name : job[1] + "/" + name;
                    if (MIME_DIR.equals(c.getString(2))) {
                        if (depth + 1 < MAX_DEPTH) queue.add(new String[]{ c.getString(0), path, String.valueOf(depth + 1) });
                        continue;
                    }
                    if (++count > MAX_FILES) { cut = true; break; }
                    JSONObject f = new JSONObject();
                    f.put("path", path);
                    f.put("size", c.isNull(3) ? -1 : c.getLong(3));
                    f.put("mtime", c.isNull(4) ? 0 : c.getLong(4));
                    files.put(f);
                }
            } catch (Exception e) {
                // 못 읽는 칸은 건너뛴다 — 나머지까지 버리지 않는다
            }
        }
        call.resolve(new JSObject().put("files", files).put("cut", cut));
    }

    /** 파일 길로 훑기 — SAF 길과 같은 꼴로 돌려준다 */
    private JSObject scanFiles(File root, String sub) {
        JSArray files = new JSArray();
        int count = 0;
        boolean cut = false;
        ArrayDeque<Object[]> queue = new ArrayDeque<>();   // { 폴더, 상대 경로, 깊이 }
        File start = sub.isEmpty() ? root : new File(root, sub);
        queue.add(new Object[]{ start, sub, 0 });
        while (!queue.isEmpty() && !cut) {
            Object[] job = queue.poll();
            File[] kids = ((File) job[0]).listFiles();
            if (kids == null) continue;                    // 못 읽는 칸은 건너뛴다
            String rel = (String) job[1];
            int depth = (Integer) job[2];
            for (File k : kids) {
                String name = k.getName();
                if (name.startsWith(".")) continue;
                String path = rel.isEmpty() ? name : rel + "/" + name;
                if (k.isDirectory()) {
                    if (depth + 1 < MAX_DEPTH) queue.add(new Object[]{ k, path, depth + 1 });
                    continue;
                }
                if (++count > MAX_FILES) { cut = true; break; }
                try {
                    JSONObject f = new JSONObject();
                    f.put("path", path);
                    f.put("size", k.length());
                    f.put("mtime", k.lastModified());
                    files.put(f);
                } catch (Exception ignored) { /* 이름이 이상한 파일 하나 */ }
            }
        }
        return new JSObject().put("files", files).put("cut", cut);
    }

    // ── 조각 읽기 ─────────────────────────────────────────────────────────

    @PluginMethod
    public void openRead(PluginCall call) {
        String rel = call.getString("rel");
        if (!TojesusLink.safeRel(rel)) { call.reject("경로가 올바르지 않습니다"); return; }
        try {
            File fr = fileRoot();
            InputStream in;
            long size;
            if (fr != null) {
                File f = TojesusLink.child(fr, rel);
                in = new FileInputStream(f);
                size = f.length();
            } else {
                Uri u = DocumentsContract.buildDocumentUriUsingTree(TojesusLink.pickedTree(getContext()), rootId() + "/" + rel);
                in = cr().openInputStream(u);
                size = sizeOf(u);
            }
            if (in == null) { call.reject("파일을 열지 못했습니다"); return; }
            int h = nextHandle.getAndIncrement();
            streams.put(h, in);
            call.resolve(new JSObject().put("handle", h).put("size", size));
        } catch (NoLink e) {
            call.reject(e.getMessage());
        } catch (Exception e) {
            call.reject("열지 못했습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readNext(PluginCall call) {
        int h = call.getData().optInt("handle", -1);
        int len = Math.max(1, Math.min(call.getData().optInt("length", 1 << 20), MAX_CHUNK));
        InputStream in = streams.get(h);
        if (in == null) { call.reject("열린 파일이 없습니다"); return; }
        try {
            byte[] buf = new byte[len];
            int off = 0, n;
            while (off < len && (n = in.read(buf, off, len - off)) > 0) off += n;
            boolean eof = off < len;
            if (eof) closeStream(h);
            call.resolve(new JSObject()
                .put("data", android.util.Base64.encodeToString(buf, 0, off, android.util.Base64.NO_WRAP))
                .put("eof", eof));
        } catch (OutOfMemoryError oom) {
            closeStream(h);
            call.reject("기기 메모리가 모자라 읽지 못했습니다", "NO_MEMORY");
        } catch (Exception e) {
            closeStream(h);
            call.reject("읽지 못했습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void closeRead(PluginCall call) {
        closeStream(call.getData().optInt("handle", -1));
        call.resolve();
    }

    private void closeStream(int h) {
        InputStream in = streams.remove(h);
        if (in == null) return;
        try { in.close(); } catch (Exception ignored) { /* 닫기 실패는 할 일이 없다 */ }
    }

    // ── 압축파일 ─────────────────────────────────────────────────────────

    @PluginMethod
    public void pickZip(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{ "application/zip", "application/x-zip-compressed", "application/octet-stream" });
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        startActivityForResult(call, i, "zipPicked");
    }

    @ActivityCallback
    private void zipPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        JSArray files = new JSArray();
        if (data != null) {
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) addPicked(files, data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) addPicked(files, data.getData());
        }
        call.resolve(new JSObject().put("ok", files.length() > 0).put("files", files));
    }

    private void addPicked(JSArray files, Uri u) {
        if (u == null) return;
        String name = "";
        long size = -1;
        try (Cursor c = cr().query(u, new String[]{ OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                name = c.getString(0);
                size = c.isNull(1) ? -1 : c.getLong(1);
            }
        } catch (Exception ignored) { /* 이름을 몰라도 풀 수는 있다 */ }
        files.put(new JSObject().put("uri", u.toString()).put("name", name == null ? "" : name).put("size", size));
    }

    /** 압축 원본 — 고른 압축(uri), 또는 tojesus 안의 것(rel, 예: _inbox/data.zip)을 두 길 중 지금 길로 */
    private static final class ZipSrc {
        Uri uri;
        File file;
    }

    private ZipSrc zipSrc(PluginCall call) {
        ZipSrc s = new ZipSrc();
        String u = call.getString("uri");
        if (u != null && !u.isEmpty()) { s.uri = Uri.parse(u); return s; }
        String rel = call.getString("rel");
        if (!TojesusLink.safeRel(rel)) return null;
        try {
            File fr = fileRoot();
            if (fr != null) { s.file = TojesusLink.child(fr, rel); return s; }
            s.uri = DocumentsContract.buildDocumentUriUsingTree(TojesusLink.pickedTree(getContext()), rootId() + "/" + rel);
            return s;
        } catch (Exception e) {
            return null;
        }
    }

    /** 원본을 읽는 통로 — 채널(건너뛰며 읽기)이 되는 FileInputStream. 닫으면 다 닫힌다 */
    private FileInputStream openSrc(ZipSrc s) throws IOException {
        if (s.file != null) return new FileInputStream(s.file);
        ParcelFileDescriptor pfd = cr().openFileDescriptor(s.uri, "r");
        if (pfd == null) throw new IOException("압축파일을 열지 못했습니다");
        return new ParcelFileDescriptor.AutoCloseInputStream(pfd);
    }

    @PluginMethod
    public void zipList(PluginCall call) {
        ZipSrc src = zipSrc(call);
        if (src == null) { call.reject("압축파일이 없습니다"); return; }
        try (FileInputStream fis = openSrc(src)) {
            ZipIndex z = ZipIndex.open(fis.getChannel());
            JSArray arr = new JSArray();
            long total = 0;
            for (ZipIndex.Entry e : z.entries()) {
                JSONObject o = new JSONObject();
                o.put("i", e.index);
                o.put("name", e.name);
                o.put("size", e.size);
                o.put("dir", e.dir);
                arr.put(o);
                if (!e.dir) total += e.size;
            }
            call.resolve(new JSObject().put("entries", arr).put("totalBytes", total));
        } catch (Exception e) {
            call.reject("압축파일을 열지 못했습니다: " + e.getMessage()
                + "\n\n기기에 다 내려받은 압축파일인지 확인해 주세요(구름 폴더에 있는 것은 바로 풀 수 없습니다).");
        }
    }

    @PluginMethod
    public void zipExtract(PluginCall call) {
        ZipSrc src = zipSrc(call);
        JSONArray items = call.getData().optJSONArray("items");
        Sink sink;
        try {
            File fr = fileRoot();
            if (fr != null && !TojesusLink.canWrite(getContext(), fr)) { call.reject(READ_ONLY_MSG, "READ_ONLY"); return; }
            sink = fr != null ? new FileSink(fr) : new SafSink(TojesusLink.pickedTree(getContext()), rootId());
        } catch (NoLink e) { sink = null; }
        if (src == null || sink == null) { call.reject("압축파일이나 tojesus 폴더가 없습니다"); return; }
        if (items == null || items.length() == 0) { call.resolve(new JSObject().put("wrote", 0)); return; }
        if (!extracting.compareAndSet(false, true)) { call.reject("이미 풀고 있습니다"); return; }
        cancel.set(false);
        final Sink out = sink;
        // 오래 걸린다 — 다른 부름(그만두기 등)을 막지 않게 따로 돈다
        new Thread(() -> {
            JSObject res = null;
            String err = null;
            try { res = extract(src, out, items); }
            catch (Throwable e) { err = e instanceof OutOfMemoryError ? "기기 메모리가 모자랍니다" : e.getMessage(); }   // 어떤 경우에도 응답한다 — 안 그러면 화면이 영영 기다린다
            extracting.set(false);   // 응답보다 먼저 푼다 — 곧바로 다음 압축을 부를 수 있게
            if (res != null) call.resolve(res); else call.reject("풀지 못했습니다: " + err);
        }, "tojesus-unzip").start();
    }

    @PluginMethod
    public void cancelExtract(PluginCall call) {
        cancel.set(true);
        call.resolve();
    }

    private JSObject extract(ZipSrc src, Sink sink, JSONArray items) throws Exception {
        int wrote = 0, same = 0, failed = 0;
        JSArray failedNames = new JSArray();
        try (FileInputStream fis = openSrc(src)) {
            ZipIndex z = ZipIndex.open(fis.getChannel());
            List<ZipIndex.Entry> all = z.entries();
            long totalBytes = 0, bytes = 0;
            for (int k = 0; k < items.length(); k++) {
                int i = items.getJSONObject(k).optInt("i", -1);
                if (i >= 0 && i < all.size()) totalBytes += all.get(i).size;
            }
            byte[] buf = new byte[1 << 18];
            long lastNote = 0;
            for (int k = 0; k < items.length(); k++) {
                if (cancel.get()) break;
                JSONObject it = items.getJSONObject(k);
                int i = it.optInt("i", -1);
                String dest = it.optString("dest", "");
                if (i < 0 || i >= all.size() || !TojesusLink.safeRel(dest)) { failed++; failedNames.put(dest); continue; }
                ZipIndex.Entry e = all.get(i);
                dest = fatSafe(dest);   // 제공자가 바꿔 버릴 글자(? : * 등)는 미리 바꾼다 — 다음에 같은 이름으로 찾을 수 있게
                int slash = dest.lastIndexOf('/');
                String dirRel = slash < 0 ? "" : dest.substring(0, slash), leaf = dest.substring(slash + 1);
                notify(k, items.length(), leaf, bytes, totalBytes);
                try {
                    if (sink.same(dirRel, leaf, e.size)) { same++; bytes += e.size; continue; }
                    long got = 0;
                    boolean done = false;
                    try {
                        try (InputStream in = z.open(e); OutputStream os = sink.open(dirRel, leaf)) {
                            int n;
                            while ((n = in.read(buf)) > 0) {
                                if (cancel.get()) break;
                                os.write(buf, 0, n);
                                got += n;
                                bytes += n;
                                long now = System.currentTimeMillis();
                                if (now - lastNote > 400) { lastNote = now; notify(k, items.length(), leaf, bytes, totalBytes); }
                            }
                            done = !cancel.get();
                        }
                        // 압축이 잘렸으면 짧은 파일이 「성공」으로 남는다 — 목차의 크기와 견준다
                        if (done && got != e.size) throw new IOException("크기가 맞지 않습니다(" + got + "/" + e.size + ")");
                    } catch (Exception | OutOfMemoryError ex) {
                        sink.discard(dirRel, leaf);   // 반쯤 쓴 파일을 남기지 않는다 — 다음 재등록이 깨진 자료를 읽지 않게
                        throw ex;
                    }
                    if (done) wrote++;
                    else sink.discard(dirRel, leaf);   // 그만두었다
                } catch (Exception ex) {
                    failed++;
                    failedNames.put(dest);
                }
            }
        }
        return new JSObject().put("wrote", wrote).put("same", same).put("failed", failed)
            .put("failedNames", failedNames).put("cancelled", cancel.get());
    }

    /** 풀어 쓸 자리 — 파일 길과 SAF 길이 같은 모양으로 */
    private interface Sink {
        /** 같은 크기의 파일이 이미 있나(그러면 건너뛴다) */
        boolean same(String dirRel, String leaf, long size) throws IOException;
        /** 그 이름이 이미 있나(크기와 상관없이) — 매일찬양 모으기가 이름을 비켜 갈 때 */
        boolean has(String dirRel, String leaf) throws IOException;
        /** 쓸 통로 — 없는 폴더는 만들어 가며 */
        OutputStream open(String dirRel, String leaf) throws IOException;
        /** 반쯤 쓴 파일 지우기 */
        void discard(String dirRel, String leaf);
        /** 다 쓴 임시 파일을 진짜 이름으로 — 같은 폴더 안에서만. 못 하면 false */
        boolean rename(String dirRel, String from, String to);
    }

    private static final class FileSink implements Sink {
        private final File root;

        FileSink(File root) { this.root = root; }

        private File at(String dirRel, String leaf) throws IOException {
            return TojesusLink.child(root, dirRel.isEmpty() ? leaf : dirRel + "/" + leaf);
        }

        @Override public boolean same(String dirRel, String leaf, long size) throws IOException {
            File f = at(dirRel, leaf);
            return f.isFile() && f.length() == size;
        }

        @Override public boolean has(String dirRel, String leaf) throws IOException { return at(dirRel, leaf).exists(); }

        @Override public OutputStream open(String dirRel, String leaf) throws IOException {
            File f = at(dirRel, leaf);
            File dir = f.getParentFile();
            if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("폴더를 만들지 못했습니다: " + dirRel);
            return new FileOutputStream(f);
        }

        @Override public void discard(String dirRel, String leaf) {
            try { File f = at(dirRel, leaf); if (f.exists() && !f.delete()) f.deleteOnExit(); }
            catch (IOException ignored) { /* 다음에 다시 쓰면 된다 */ }
        }

        @Override public boolean rename(String dirRel, String from, String to) {
            try {
                File a = at(dirRel, from), b = at(dirRel, to);
                return !b.exists() && a.renameTo(b);
            } catch (IOException e) { return false; }
        }
    }

    private final class SafSink implements Sink {
        private final Uri tree;
        private final Map<String, String> dirIds = new HashMap<>();               // tojesus 안 상대 경로 → 문서 id
        private final Map<String, Map<String, String[]>> kidsOf = new HashMap<>();  // 폴더 id → { 이름 → [id, 종류, 크기] }
        private final Map<String, Uri> opened = new HashMap<>();

        SafSink(Uri tree, String root) { this.tree = tree; dirIds.put("", root); }

        private Map<String, String[]> kids(String dirRel) throws IOException {
            String dirId = dirFor(tree, dirRel, dirIds, kidsOf);
            return kidsOf.computeIfAbsent(dirId, d -> childrenQuiet(tree, d));
        }

        @Override public boolean same(String dirRel, String leaf, long size) throws IOException {
            String[] have = kids(dirRel).get(leaf);
            return have != null && Long.parseLong(have[2]) == size;
        }

        @Override public boolean has(String dirRel, String leaf) throws IOException { return kids(dirRel).containsKey(leaf); }

        @Override public OutputStream open(String dirRel, String leaf) throws IOException {
            Map<String, String[]> kids = kids(dirRel);
            String[] have = kids.get(leaf);
            Uri out;
            if (have != null) out = DocumentsContract.buildDocumentUriUsingTree(tree, have[0]);
            else {
                out = DocumentsContract.createDocument(cr(), DocumentsContract.buildDocumentUriUsingTree(tree, dirIds.get(dirRel)), MIME_BIN, leaf);
                if (out == null) throw new IOException("파일을 만들지 못했습니다");
                kids.put(leaf, new String[]{ DocumentsContract.getDocumentId(out), MIME_BIN, "-1" });
            }
            opened.put(dirRel + "/" + leaf, out);
            OutputStream os = cr().openOutputStream(out, "wt");
            if (os == null) throw new IOException("쓰지 못했습니다");
            return os;
        }

        @Override public void discard(String dirRel, String leaf) {
            Uri out = opened.remove(dirRel + "/" + leaf);
            if (out == null) return;
            try { DocumentsContract.deleteDocument(cr(), out); } catch (Exception ignored) { /* 다음에 다시 쓰면 된다 */ }
            Map<String, String[]> k = kidsOf.get(dirIds.get(dirRel));
            if (k != null) k.remove(leaf);
        }

        @Override public boolean rename(String dirRel, String from, String to) {
            Uri u = opened.remove(dirRel + "/" + from);
            if (u == null) return false;
            try {
                Map<String, String[]> k = kids(dirRel);
                if (k.containsKey(to)) { opened.put(dirRel + "/" + from, u); return false; }
                Uri done = DocumentsContract.renameDocument(cr(), u, to);
                if (done == null) { opened.put(dirRel + "/" + from, u); return false; }
                String[] was = k.remove(from);
                k.put(to, new String[]{ DocumentsContract.getDocumentId(done), was == null ? MIME_BIN : was[1], was == null ? "-1" : was[2] });
                opened.put(dirRel + "/" + to, done);
                return true;
            } catch (Exception e) {
                opened.put(dirRel + "/" + from, u);
                return false;
            }
        }
    }

    /** 기기 저장소(FAT 계열)가 받지 않는 글자를 _ 로 — 제공자가 몰래 바꾸면 다음에 같은 이름으로 찾지 못해 사본이 늘어난다 */
    private static String fatSafe(String rel) {
        return rel.replaceAll("[?:*\"<>|\\u0000-\\u001f]", "_");
    }

    private void notify(int done, int total, String name, long bytes, long totalBytes) {
        notifyListeners("zipProgress", new JSObject().put("done", done).put("total", total)
            .put("name", name).put("bytes", bytes).put("totalBytes", totalBytes));
    }

    /** tojesus 안 상대 경로의 폴더 id — 없는 칸은 만들어 가며 내려간다 */
    private String dirFor(Uri tree, String rel, Map<String, String> dirIds, Map<String, Map<String, String[]>> kidsOf) throws IOException {
        if (dirIds.containsKey(rel)) return dirIds.get(rel);
        int slash = rel.lastIndexOf('/');
        String parentRel = slash < 0 ? "" : rel.substring(0, slash), name = rel.substring(slash + 1);
        String parent = dirFor(tree, parentRel, dirIds, kidsOf);
        Map<String, String[]> kids = kidsOf.computeIfAbsent(parent, d -> childrenQuiet(tree, d));
        String[] have = kids.get(name);
        String id;
        if (have != null && MIME_DIR.equals(have[1])) id = have[0];
        else {
            Uri made;
            try { made = DocumentsContract.createDocument(cr(), DocumentsContract.buildDocumentUriUsingTree(tree, parent), MIME_DIR, name); }
            catch (Exception e) { throw new IOException("폴더를 만들지 못했습니다: " + rel, e); }
            if (made == null) throw new IOException("폴더를 만들지 못했습니다: " + rel);
            id = DocumentsContract.getDocumentId(made);
            kids.put(name, new String[]{ id, MIME_DIR, "0" });
        }
        dirIds.put(rel, id);
        return id;
    }

    // ── 매일찬양 모으기 (v5.30.0, 설계 14항) ─────────────────────────────
    // 「위치 등록」 곡이나 앱 안 곡을 tojesus/praise/<앨범>/ 으로 들여온다. dest 는 praise 기준 「앨범/곡.mp3」.
    //   praiseCopy({ from: { loc, path }, dest, move })   등록 위치의 곡을 복사(move 면 다 쓴 뒤 원본을 지운다)
    //                    → { path: 실제로 쓴 praise 기준 경로, same, moved }
    //   praiseWriteBegin({ dest, size }) → { handle, path } 또는 { same: true, path }   앱 안 곡(웹이 조각으로 넘긴다)
    //   praiseWriteChunk({ handle, data(base64) }) · praiseWriteEnd({ handle }) · praiseWriteAbort({ handle })
    // 같은 이름이 이미 있으면: 크기가 같으면 그 파일을 그대로 쓰고(same), 다르면 「이름 (2).mp3」 로 비켜 쓴다.
    // 오래 걸릴 수 있어 따로 돈다 — 플러그인 부름이 한 줄로 서므로 재생 리모컨이 막히지 않게.

    private static final class PraiseOut {
        final Sink sink; final String dirRel, leaf; final OutputStream os; final long size; long wrote;
        PraiseOut(Sink sink, String dirRel, String leaf, OutputStream os, long size) {
            this.sink = sink; this.dirRel = dirRel; this.leaf = leaf; this.os = os; this.size = size;
        }
    }
    private final Map<Integer, PraiseOut> praiseOuts = new ConcurrentHashMap<>();
    /** 쓰는 중인 곡의 꼬리표 — 소리 파일 이름이 아니라 훑기·담기에서 곡으로 잡히지 않는다 */
    static final String PART = ".praise-part";

    /** tojesus 에 쓸 자리 — 못 쓰면 거절하고 null */
    private Sink praiseSink(PluginCall call) {
        File fr;
        try { fr = fileRoot(); } catch (NoLink e) { call.reject(e.getMessage(), "NO_LINK"); return null; }
        if (fr != null) {
            if (!TojesusLink.canWrite(getContext(), fr)) { call.reject(READ_ONLY_MSG, "READ_ONLY"); return null; }
            return new FileSink(fr);
        }
        Uri tree = TojesusLink.pickedTree(getContext());
        boolean write = false;
        for (UriPermission p : cr().getPersistedUriPermissions()) if (p.getUri().equals(tree) && p.isWritePermission()) write = true;
        if (!write) { call.reject("고른 tojesus 폴더에 쓸 권한이 없습니다 — ⚙ 파일관리 › 「다른 폴더 고르기」로 다시 골라 주세요", "READ_ONLY"); return null; }
        return new SafSink(tree, rootId());
    }

    /** 쓸 자리 { dirRel(tojesus 기준), leaf, same("1"/"0") } — 이름이 겹치면 비켜 간다 */
    private static String[] praisePlace(Sink sink, String dest, long size) throws IOException {
        dest = fatSafe(dest);
        int slash = dest.lastIndexOf('/');
        String dirRel = "praise" + (slash < 0 ? "" : "/" + dest.substring(0, slash)), leaf = dest.substring(slash + 1);
        if (!sink.has(dirRel, leaf)) return new String[]{ dirRel, leaf, "0" };
        if (size >= 0 && sink.same(dirRel, leaf, size)) return new String[]{ dirRel, leaf, "1" };
        int dot = leaf.lastIndexOf('.');
        String base = dot > 0 ? leaf.substring(0, dot) : leaf, ext = dot > 0 ? leaf.substring(dot) : "";
        for (int n = 2; n < 100; n++) {
            String cand = base + " (" + n + ")" + ext;
            if (!sink.has(dirRel, cand)) return new String[]{ dirRel, cand, "0" };
            if (size >= 0 && sink.same(dirRel, cand, size)) return new String[]{ dirRel, cand, "1" };
        }
        throw new IOException("같은 이름의 파일이 너무 많습니다: " + leaf);
    }

    private static String praiseRel(String dirRel, String leaf) {
        String d = dirRel.equals("praise") ? "" : dirRel.substring("praise/".length()) + "/";
        return d + leaf;
    }

    @PluginMethod
    public void praiseCopy(PluginCall call) {
        JSONObject from = call.getData().optJSONObject("from");
        String dest = call.getString("dest");
        boolean move = Boolean.TRUE.equals(call.getBoolean("move", false));
        if (from == null || !TojesusLink.safeRel(dest)) { call.reject("경로가 올바르지 않습니다"); return; }
        String loc = from.optString("loc"), path = from.optString("path");
        Sink sink = praiseSink(call);
        if (sink == null) return;
        new Thread(() -> {
            String[] at = null;
            boolean writing = false;
            try {
                ParcelFileDescriptor pfd = PraiseLink.open(getContext(), loc, path);
                long size = pfd.getStatSize();
                try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd)) {   // 닫으면 파일 손잡이도 함께 닫힌다
                    at = praisePlace(sink, dest, size);
                    boolean same = "1".equals(at[2]);
                    if (!same) {
                        long got = 0;
                        writing = true;
                        // 임시 이름으로 쓰고 다 쓴 뒤에만 진짜 이름으로 — 도중에 앱이 꺼져도 잘린 곡이 「곡」으로 남지 않게
                        try (OutputStream os = sink.open(at[0], at[1] + PART)) {
                            byte[] buf = new byte[1 << 18];
                            int n;
                            while ((n = in.read(buf)) > 0) { os.write(buf, 0, n); got += n; }
                        }
                        if (size >= 0 && got != size) throw new IOException("크기가 맞지 않습니다(" + got + "/" + size + ")");
                        if (!sink.rename(at[0], at[1] + PART, at[1])) throw new IOException("다 쓴 파일의 이름을 바꾸지 못했습니다");
                        writing = false;
                    }
                }
                // 이동 — 새 자리에 다 쓴 것을 확인한 뒤에만 원본을 지운다(닫은 뒤에).
                // 「같은 파일이 이미 있다」(same)였으면, 그것이 원본 자체일 수 있다(등록 위치가 tojesus/praise 안).
                // 두 파일이 서로 다른 것을 파일 경로로 확인할 수 있을 때만 지운다 — 못 하면 원본을 남긴다
                boolean moved = move && (!"1".equals(at[2]) || distinct(loc, path, at)) && PraiseLink.delete(getContext(), loc, path);
                call.resolve(new JSObject().put("path", praiseRel(at[0], at[1])).put("same", "1".equals(at[2])).put("moved", moved));
            } catch (Throwable e) {
                if (writing && at != null) sink.discard(at[0], at[1] + PART);   // 반쯤 쓴 파일을 남기지 않는다
                call.reject("옮기지 못했습니다: " + (e instanceof OutOfMemoryError ? "기기 메모리가 모자랍니다" : e.getMessage()));
            }
        }, "praise-collect").start();
    }

    /** 원본(등록 위치)과 새 자리(tojesus)가 다른 파일인가 — 둘 다 파일 경로로 알 수 있을 때만 true */
    private boolean distinct(String loc, String path, String[] at) {
        File src = PraiseLink.fileOf(getContext(), loc, path);
        File root = TojesusLink.autoRoot(getContext());
        if (src == null || root == null || !"auto".equals(TojesusLink.way(getContext()))) return false;
        try {
            File dst = TojesusLink.child(root, at[0] + "/" + at[1]).getCanonicalFile();
            return !dst.equals(src);
        } catch (IOException e) { return false; }
    }

    @PluginMethod
    public void praiseWriteBegin(PluginCall call) {
        String dest = call.getString("dest");
        long size = call.getData().optLong("size", -1);
        if (!TojesusLink.safeRel(dest)) { call.reject("경로가 올바르지 않습니다"); return; }
        Sink sink = praiseSink(call);
        if (sink == null) return;
        try {
            String[] at = praisePlace(sink, dest, size);
            if ("1".equals(at[2])) { call.resolve(new JSObject().put("same", true).put("path", praiseRel(at[0], at[1]))); return; }
            OutputStream os = sink.open(at[0], at[1] + PART);   // 임시 이름 — praiseWriteEnd 에서 진짜 이름으로
            int h = nextHandle.getAndIncrement();
            praiseOuts.put(h, new PraiseOut(sink, at[0], at[1], os, size));
            call.resolve(new JSObject().put("handle", h).put("path", praiseRel(at[0], at[1])));
        } catch (Exception e) {
            call.reject("쓸 자리를 만들지 못했습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void praiseWriteChunk(PluginCall call) {
        PraiseOut o = praiseOuts.get(call.getData().optInt("handle", -1));
        if (o == null) { call.reject("열린 파일이 없습니다"); return; }
        try {
            byte[] b = android.util.Base64.decode(call.getString("data", ""), android.util.Base64.DEFAULT);
            o.os.write(b);
            o.wrote += b.length;
            call.resolve();
        } catch (Exception | OutOfMemoryError e) {
            praiseAbort(call.getData().optInt("handle", -1));
            call.reject("쓰지 못했습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void praiseWriteEnd(PluginCall call) {
        int h = call.getData().optInt("handle", -1);
        PraiseOut o = praiseOuts.remove(h);
        if (o == null) { call.reject("열린 파일이 없습니다"); return; }
        try { o.os.close(); }
        catch (IOException e) { o.sink.discard(o.dirRel, o.leaf + PART); call.reject("다 쓰지 못했습니다: " + e.getMessage()); return; }
        if (o.size >= 0 && o.wrote != o.size) {
            o.sink.discard(o.dirRel, o.leaf + PART);
            call.reject("크기가 맞지 않습니다(" + o.wrote + "/" + o.size + ")");
            return;
        }
        if (!o.sink.rename(o.dirRel, o.leaf + PART, o.leaf)) {
            o.sink.discard(o.dirRel, o.leaf + PART);
            call.reject("다 쓴 파일의 이름을 바꾸지 못했습니다");
            return;
        }
        call.resolve(new JSObject().put("path", praiseRel(o.dirRel, o.leaf)));
    }

    @PluginMethod
    public void praiseWriteAbort(PluginCall call) {
        praiseAbort(call.getData().optInt("handle", -1));
        call.resolve();
    }

    private void praiseAbort(int h) {
        PraiseOut o = praiseOuts.remove(h);
        if (o == null) return;
        try { o.os.close(); } catch (Exception ignored) { /* 지울 것이다 */ }
        o.sink.discard(o.dirRel, o.leaf + PART);
    }

    /** 도중에 앱이 꺼져 남은 임시 파일 하나를 치운다 — praise/ 아래 「….praise-part」 만 받는다(진짜 곡은 지우지 못하게) */
    @PluginMethod
    public void praiseDropPart(PluginCall call) {
        String rel = call.getString("rel");
        if (!TojesusLink.safeRel(rel) || !rel.startsWith("praise/") || !rel.endsWith(PART)) { call.reject("임시 파일이 아닙니다"); return; }
        try {
            File fr = fileRoot();
            boolean ok;
            if (fr != null) {
                if (!TojesusLink.canWrite(getContext(), fr)) { call.reject(READ_ONLY_MSG, "READ_ONLY"); return; }
                File f = TojesusLink.child(fr, rel);
                ok = !f.exists() || f.delete();
            } else {
                ok = DocumentsContract.deleteDocument(cr(), DocumentsContract.buildDocumentUriUsingTree(TojesusLink.pickedTree(getContext()), rootId() + "/" + rel));
            }
            call.resolve(new JSObject().put("ok", ok));
        } catch (Exception e) {
            call.reject("지우지 못했습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void deleteDoc(PluginCall call) {
        ZipSrc s = zipSrc(call);
        if (s == null) { call.reject("지울 파일이 없습니다"); return; }
        try {
            if (s.file != null && !TojesusLink.canWrite(getContext(), TojesusLink.autoRoot(getContext()))) { call.reject(READ_ONLY_MSG, "READ_ONLY"); return; }
            boolean ok = s.file != null ? s.file.delete() : DocumentsContract.deleteDocument(cr(), s.uri);
            call.resolve(new JSObject().put("ok", ok));
        } catch (Exception e) {
            call.reject("지우지 못했습니다: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        cancel.set(true);
        for (Integer h : new java.util.ArrayList<>(streams.keySet())) closeStream(h);
        for (Integer h : new java.util.ArrayList<>(praiseOuts.keySet())) praiseAbort(h);
    }

    // ── 자잘한 것들 ───────────────────────────────────────────────────────

    /** 폴더의 바로 아래 — { 이름 → [id, 종류, 크기] } */
    private Map<String, String[]> children(Uri tree, String dirId) throws IOException {
        Map<String, String[]> out = new HashMap<>();
        try (Cursor c = cr().query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, dirId), COLS, null, null, null)) {
            while (c != null && c.moveToNext()) {
                String name = c.getString(1);
                if (name != null) out.put(name, new String[]{ c.getString(0), c.getString(2), String.valueOf(c.isNull(3) ? -1 : c.getLong(3)) });
            }
        } catch (Exception e) {
            throw new IOException("폴더를 읽지 못했습니다", e);
        }
        return out;
    }

    private Map<String, String[]> childrenQuiet(Uri tree, String dirId) {
        try { return children(tree, dirId); } catch (IOException e) { return new HashMap<>(); }
    }

    private String nameOf(Uri tree, String docId) {
        try (Cursor c = cr().query(DocumentsContract.buildDocumentUriUsingTree(tree, docId),
                new String[]{ DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { /* 없거나 못 읽는다 */ }
        return null;
    }

    private long sizeOf(Uri u) {
        try (Cursor c = cr().query(u, new String[]{ OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getLong(0);
        } catch (Exception ignored) { /* 크기를 몰라도 읽기는 된다 */ }
        return -1;
    }
}
