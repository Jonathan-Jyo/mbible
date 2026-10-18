package com.jonathan.biblemem;

// ============================================================================
// TojesusFolder — 자료 폴더 tojesus/ 하나를 앱에 연결한다 (안드로이드 SAF, 읽기·쓰기)
// ============================================================================
// 설계: docs/tojesus-자료폴더-설계.md
//
// 휴대폰·태블릿에서 자료를 들이는 표준 길이다. 내장 저장소나 SD카드 맨 위의 tojesus 폴더를
// 처음 한 번 고르면 그 뒤로는 묻지 않는다(권한이 남는다). 앱을 지워도 폴더는 남는다.
//
//   pick()                      폴더 고르기 — tojesus 를 고르거나, 그 위 폴더를 고르면 안에서 찾거나 만든다
//   status()                    { linked, ok, writable, sd, where, path, tree, root }
//   forget()
//   ensureDirs({ names, marker })   빠진 구역 폴더를 만들고 표지(tojesus.json)를 쓴다
//   scan()                      { files:[{ path, size, mtime }], cut }
//   openRead/readNext/closeRead 조각 읽기(1MB) — 자료 파일을 앱 안으로 옮길 때
//   pickZip()                   압축파일 고르기(여럿) → { files:[{ uri, name, size }] }
//   zipList({ uri | rel })      압축 목차 — { entries:[{ i, name, size, dir }] }
//   zipExtract({ uri | rel, items:[{ i, dest }] })   tojesus 안의 dest 경로로 흘려 풀기
//                               진행은 "zipProgress" { done, total, name, bytes, totalBytes } 로 알린다
//   cancelExtract()
//   deleteDoc({ uri | rel })    다 푼 압축 원본 지우기(사람이 고른 뒤)
// ============================================================================

import android.content.ContentResolver;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.FileInputStream;
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

@CapacitorPlugin(name = "TojesusFolder")
public class TojesusFolderPlugin extends Plugin {

    private static final String PREF = "tojesus_folder";
    private static final String K_TREE = "tree", K_ROOT = "root";
    private static final String ROOT_NAME = "tojesus";
    private static final String EXT_AUTH = "com.android.externalstorage.documents";
    private static final String MIME_DIR = DocumentsContract.Document.MIME_TYPE_DIR;
    /** 이름을 그대로 두게 하는 종류 — 다른 종류로 만들면 제공자가 확장자를 덧붙이기도 한다 */
    private static final String MIME_BIN = "application/octet-stream";
    private static final int MAX_DEPTH = 8;
    private static final int MAX_FILES = 60000;
    private static final int MAX_CHUNK = 4 << 20;

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

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREF, 0); }
    private ContentResolver cr() { return getContext().getContentResolver(); }

    // ── 연결 ──────────────────────────────────────────────────────────────

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
            if (old != null && !old.equals(tree.toString())) {   // 다른 자리로 옮겼다 — 옛 권한은 놓아 준다(권한 수에 한도가 있다)
                try { cr().releasePersistableUriPermission(Uri.parse(old), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); }
                catch (Exception ignored) { /* 이미 거둬졌다 */ }
            }
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
        Uri tree = savedTree();
        if (tree != null) {
            try {
                cr().releasePersistableUriPermission(tree,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) { /* 이미 거둬졌다 */ }
        }
        prefs().edit().clear().apply();
        call.resolve(new JSObject().put("ok", true));
    }

    private JSObject statusObj() {
        String t = prefs().getString(K_TREE, null), root = prefs().getString(K_ROOT, null);
        JSObject o = new JSObject().put("linked", t != null && root != null);
        if (t == null || root == null) return o;
        Uri tree = Uri.parse(t);
        boolean read = false, write = false;
        for (UriPermission p : cr().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree)) { read = p.isReadPermission(); write = p.isWritePermission(); }
        }
        boolean exists = read && nameOf(tree, root) != null;
        boolean sd = !root.startsWith("primary:");
        String rel = root.contains(":") ? root.substring(root.indexOf(':') + 1) : root;
        return o.put("ok", exists).put("writable", exists && write).put("sd", sd)
            .put("where", sd ? "SD카드" : "내장 저장소").put("path", rel)
            .put("tree", t).put("root", root);
    }

    /** 살아 있는 연결 — 권한이 거둬졌거나 폴더가 없으면 null */
    private Uri savedTree() {
        String t = prefs().getString(K_TREE, null);
        if (t == null) return null;
        Uri tree = Uri.parse(t);
        for (UriPermission p : cr().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isReadPermission()) return tree;
        }
        return null;
    }

    private String rootId() { return prefs().getString(K_ROOT, null); }

    // ── 폴더 만들기 · 훑기 ───────────────────────────────────────────────

    @PluginMethod
    public void ensureDirs(PluginCall call) {
        Uri tree = savedTree();
        String root = rootId();
        if (tree == null || root == null) { call.reject("tojesus 폴더가 연결되어 있지 않습니다"); return; }
        try {
            Map<String, String[]> kids = children(tree, root);
            JSArray made = new JSArray();
            JSONArray names = call.getData().optJSONArray("names");
            for (int i = 0; names != null && i < names.length(); i++) {
                String n = names.optString(i, "");
                if (!safeSeg(n) || kids.containsKey(n)) continue;
                Uri u = DocumentsContract.createDocument(cr(), DocumentsContract.buildDocumentUriUsingTree(tree, root), MIME_DIR, n);
                if (u != null) made.put(n);
            }
            String marker = call.getString("marker");
            if (marker != null && !kids.containsKey("tojesus.json")) {
                Uri u = DocumentsContract.createDocument(cr(), DocumentsContract.buildDocumentUriUsingTree(tree, root), MIME_BIN, "tojesus.json");
                if (u != null) {
                    try (OutputStream out = cr().openOutputStream(u, "w")) {
                        if (out != null) out.write(marker.getBytes(StandardCharsets.UTF_8));
                    }
                }
            }
            call.resolve(new JSObject().put("made", made));
        } catch (Exception e) {
            call.reject("폴더를 만들지 못했습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void scan(PluginCall call) {
        Uri tree = savedTree();
        String root = rootId();
        if (tree == null || root == null) { call.reject("tojesus 폴더가 연결되어 있지 않습니다"); return; }
        JSArray files = new JSArray();
        int count = 0;
        boolean cut = false;
        ArrayDeque<String[]> queue = new ArrayDeque<>();   // { 문서 id, 상대 경로, 깊이 }
        queue.add(new String[]{ root, "", "0" });
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

    // ── 조각 읽기 ─────────────────────────────────────────────────────────

    @PluginMethod
    public void openRead(PluginCall call) {
        Uri tree = savedTree();
        String rel = call.getString("rel");
        if (tree == null || rootId() == null) { call.reject("tojesus 폴더가 연결되어 있지 않습니다"); return; }
        if (!safeRel(rel)) { call.reject("경로가 올바르지 않습니다"); return; }
        Uri u = DocumentsContract.buildDocumentUriUsingTree(tree, rootId() + "/" + rel);
        try {
            InputStream in = cr().openInputStream(u);
            if (in == null) { call.reject("파일을 열지 못했습니다"); return; }
            int h = nextHandle.getAndIncrement();
            streams.put(h, in);
            call.resolve(new JSObject().put("handle", h).put("size", sizeOf(u)));
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

    /** 압축의 자리 — 고른 압축(uri) 또는 tojesus 안의 것(rel, 예: _inbox/data.zip) */
    private Uri zipUri(PluginCall call) {
        String u = call.getString("uri");
        if (u != null && !u.isEmpty()) return Uri.parse(u);
        String rel = call.getString("rel");
        Uri tree = savedTree();
        if (tree == null || rootId() == null || !safeRel(rel)) return null;
        return DocumentsContract.buildDocumentUriUsingTree(tree, rootId() + "/" + rel);
    }

    @PluginMethod
    public void zipList(PluginCall call) {
        Uri u = zipUri(call);
        if (u == null) { call.reject("압축파일이 없습니다"); return; }
        try (ParcelFileDescriptor pfd = openPfd(u);
             FileInputStream fis = new FileInputStream(pfd.getFileDescriptor())) {
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
        Uri src = zipUri(call);
        Uri tree = savedTree();
        String root = rootId();
        JSONArray items = call.getData().optJSONArray("items");
        if (src == null || tree == null || root == null) { call.reject("압축파일이나 tojesus 폴더가 없습니다"); return; }
        if (items == null || items.length() == 0) { call.resolve(new JSObject().put("wrote", 0)); return; }
        if (!extracting.compareAndSet(false, true)) { call.reject("이미 풀고 있습니다"); return; }
        cancel.set(false);
        // 오래 걸린다 — 다른 부름(그만두기 등)을 막지 않게 따로 돈다
        new Thread(() -> {
            JSObject res = null;
            String err = null;
            try { res = extract(src, tree, root, items); }
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

    private JSObject extract(Uri src, Uri tree, String root, JSONArray items) throws Exception {
        int wrote = 0, same = 0, failed = 0;
        JSArray failedNames = new JSArray();
        Map<String, String> dirIds = new HashMap<>();               // tojesus 안 상대 경로 → 문서 id
        Map<String, Map<String, String[]>> kidsOf = new HashMap<>();  // 폴더 id → { 이름 → [id, 종류, 크기] }
        dirIds.put("", root);
        try (ParcelFileDescriptor pfd = openPfd(src);
             FileInputStream fis = new FileInputStream(pfd.getFileDescriptor())) {
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
                if (i < 0 || i >= all.size() || !safeRel(dest)) { failed++; failedNames.put(dest); continue; }
                ZipIndex.Entry e = all.get(i);
                dest = fatSafe(dest);   // 제공자가 바꿔 버릴 글자(? : * 등)는 미리 바꾼다 — 다음에 같은 이름으로 찾을 수 있게
                int slash = dest.lastIndexOf('/');
                String dirRel = slash < 0 ? "" : dest.substring(0, slash), leaf = dest.substring(slash + 1);
                notify(k, items.length(), leaf, bytes, totalBytes);
                try {
                    String dirId = dirFor(tree, dirRel, dirIds, kidsOf);
                    Map<String, String[]> kids = kidsOf.computeIfAbsent(dirId, d -> childrenQuiet(tree, d));
                    String[] have = kids.get(leaf);
                    if (have != null && Long.parseLong(have[2]) == e.size) { same++; bytes += e.size; continue; }
                    Uri out;
                    if (have != null) out = DocumentsContract.buildDocumentUriUsingTree(tree, have[0]);
                    else {
                        out = DocumentsContract.createDocument(cr(), DocumentsContract.buildDocumentUriUsingTree(tree, dirId), MIME_BIN, leaf);
                        if (out == null) throw new IOException("파일을 만들지 못했습니다");
                        kids.put(leaf, new String[]{ DocumentsContract.getDocumentId(out), MIME_BIN, "-1" });
                    }
                    long got = 0;
                    boolean done = false;
                    try {
                        try (InputStream in = z.open(e); OutputStream os = cr().openOutputStream(out, "wt")) {
                            if (os == null) throw new IOException("쓰지 못했습니다");
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
                        removePartial(out, kids, leaf);   // 반쯤 쓴 파일을 남기지 않는다 — 다음 재등록이 깨진 자료를 읽지 않게
                        throw ex;
                    }
                    if (done) wrote++;
                    else removePartial(out, kids, leaf);   // 그만두었다
                } catch (Exception ex) {
                    failed++;
                    failedNames.put(dest);
                }
            }
        }
        return new JSObject().put("wrote", wrote).put("same", same).put("failed", failed)
            .put("failedNames", failedNames).put("cancelled", cancel.get());
    }

    private void removePartial(Uri out, Map<String, String[]> kids, String leaf) {
        try { DocumentsContract.deleteDocument(cr(), out); } catch (Exception ignored) { /* 다음에 다시 쓰면 된다 */ }
        kids.remove(leaf);
    }

    private ParcelFileDescriptor openPfd(Uri u) throws IOException {
        ParcelFileDescriptor pfd = cr().openFileDescriptor(u, "r");
        if (pfd == null) throw new IOException("압축파일을 열지 못했습니다");
        return pfd;
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

    @PluginMethod
    public void deleteDoc(PluginCall call) {
        Uri u = zipUri(call);
        if (u == null) { call.reject("지울 파일이 없습니다"); return; }
        try {
            boolean ok = DocumentsContract.deleteDocument(cr(), u);
            call.resolve(new JSObject().put("ok", ok));
        } catch (Exception e) {
            call.reject("지우지 못했습니다: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        cancel.set(true);
        for (Integer h : new java.util.ArrayList<>(streams.keySet())) closeStream(h);
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

    /** 폴더 밖으로 나가는 경로(.. · 맨 앞 /)를 막는다 */
    private static boolean safeRel(String rel) {
        if (rel == null || rel.isEmpty() || rel.startsWith("/")) return false;
        for (String s : rel.split("/")) if (!safeSeg(s)) return false;
        return true;
    }

    private static boolean safeSeg(String s) {
        return s != null && !s.isEmpty() && !s.equals(".") && !s.equals("..") && s.length() <= 200
            && s.indexOf('\\') < 0 && s.indexOf('\0') < 0;
    }
}
