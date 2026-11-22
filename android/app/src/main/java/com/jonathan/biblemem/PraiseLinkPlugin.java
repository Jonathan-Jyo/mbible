package com.jonathan.biblemem;

// ============================================================================
// PraiseLinkPlugin — 매일찬양 「위치 등록」과 원본 확인 (v5.30.0, 설계 14항)
// ============================================================================
//   pick({ relocate? })   폴더를 골라 위치로 등록 → { ok, id, name, local }
//                         relocate: 그 번호의 위치를 새로 고른 폴더로 바꾼다(「위치 다시 찾기」)
//   locations()           { list: [{ id, name, ok, way: "file"|"tree"|null, deletable }] }
//   forget({ id })        위치를 지운다(그 폴더를 다른 위치가 안 쓰면 권한도 놓는다)
//   list({ id })          그 위치 아래 소리 파일의 상대 경로 → { files, cut, name }
//   exists({ items })     items: [{ at: "tj"|"link", loc, path }] → { ok: [true|false|null …] } (null: tojesus 가 닿지 않아 모름)
//                         tj 의 path 는 tojesus/praise 기준 · link 의 path 는 그 위치 기준
// 곡을 복사하지 않는다 — 재생은 /_praiselink_/<id>/<경로>(TojesusMedia)
// ============================================================================

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

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

import java.io.File;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "PraiseLink")
public class PraiseLinkPlugin extends Plugin {

    private static final int MAX_DEPTH = 4;
    private static final int MAX_FILES = 40000;

    // ── 고르기 ──────────────────────────────────────────────────────────

    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        // 쓰기까지 받아 둔다 — 「모으기 › 이동」 때 원본을 지우려면 필요하다
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                 | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri tree = data == null ? null : data.getData();
        if (tree == null) { call.resolve(new JSObject().put("ok", false)); return; }
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception e) {
            try { getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (Exception ignored) { call.reject("이 폴더의 권한을 붙들지 못했습니다 — 다른 폴더를 골라 주세요"); return; }
        }
        String name = nameOf(tree);
        String relocate = call.getString("relocate");
        String id;
        if (relocate != null && !relocate.isEmpty()) {
            if (!PraiseLink.replace(getContext(), relocate, tree, name)) { call.reject("다시 찾을 위치가 없습니다"); return; }
            id = relocate;
        } else {
            id = PraiseLink.add(getContext(), tree, name);
            if (id == null) { call.reject("위치를 기억하지 못했습니다"); return; }
        }
        call.resolve(new JSObject().put("ok", true).put("id", id).put("name", name)
            .put("local", "com.android.externalstorage.documents".equals(tree.getAuthority())));
    }

    // ── 목록 ────────────────────────────────────────────────────────────

    @PluginMethod
    public void locations(PluginCall call) {
        JSONArray a = PraiseLink.list(getContext());
        JSArray out = new JSArray();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            String id = o.optString("id");
            String way = PraiseLink.fileRoot(getContext(), o) != null ? "file" : PraiseLink.tree(getContext(), o) != null ? "tree" : null;
            out.put(new JSObject().put("id", id).put("name", o.optString("name")).put("ok", way != null)
                .put("way", way).put("deletable", PraiseLink.canDelete(getContext(), id)));
        }
        call.resolve(new JSObject().put("list", out));
    }

    @PluginMethod
    public void forget(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("위치 번호가 없습니다"); return; }
        String release = PraiseLink.remove(getContext(), id);
        // 같은 폴더를 tojesus 연결이 쓰고 있으면 권한을 놓지 않는다
        if (release != null && !release.equals(TojesusLink.prefs(getContext()).getString(TojesusLink.K_TREE, null))) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(release),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (Exception ignored) { /* 이미 거둬졌다 */ }
        }
        call.resolve(new JSObject().put("ok", true));
    }

    /** 그 위치 아래 소리 파일 — 파일 길이면 파일로, 아니면 고른 폴더(SAF)로 훑는다 */
    @PluginMethod
    public void list(PluginCall call) {
        // 큰 폴더는 오래 걸린다 — 플러그인 부름 줄(재생 리모컨도 쓴다)을 막지 않게 따로 돈다
        new Thread(() -> {
            try { listNow(call); }
            catch (Throwable e) { call.reject("폴더를 읽지 못했습니다: " + e.getMessage()); }
        }, "praise-link-list").start();
    }

    private void listNow(PluginCall call) {
        JSONObject loc = PraiseLink.find(getContext(), call.getString("id"));
        if (loc == null) { call.reject("등록된 위치가 아닙니다"); return; }
        List<String> out = new ArrayList<>();
        boolean cut;
        File root = PraiseLink.fileRoot(getContext(), loc);
        if (root != null) cut = listFiles(root, out);
        else {
            Uri tree = PraiseLink.tree(getContext(), loc);
            if (tree == null) { call.reject("그 위치를 읽을 권한이 없습니다 — 「위치 다시 찾기」로 다시 골라 주세요"); return; }
            cut = listTree(tree, out);
        }
        JSArray arr = new JSArray();
        for (String s : out) arr.put(s);
        call.resolve(new JSObject().put("files", arr).put("count", out.size()).put("cut", cut).put("name", loc.optString("name")));
    }

    private static boolean listFiles(File root, List<String> out) {
        ArrayDeque<Object[]> queue = new ArrayDeque<>();
        queue.add(new Object[]{ root, "", 0 });
        while (!queue.isEmpty()) {
            Object[] job = queue.poll();
            File[] kids = ((File) job[0]).listFiles();
            if (kids == null) continue;
            String rel = (String) job[1];
            int depth = (Integer) job[2];
            for (File k : kids) {
                String path = rel.isEmpty() ? k.getName() : rel + "/" + k.getName();
                if (k.isDirectory()) { if (depth + 1 < MAX_DEPTH) queue.add(new Object[]{ k, path, depth + 1 }); }
                else if (isAudio(k.getName())) {
                    if (out.size() >= MAX_FILES) return true;
                    out.add(path);
                }
            }
        }
        return false;
    }

    private boolean listTree(Uri tree, List<String> out) {
        String[] cols = { DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE };
        ArrayDeque<String[]> queue = new ArrayDeque<>();
        queue.add(new String[]{ DocumentsContract.getTreeDocumentId(tree), "", "0" });
        while (!queue.isEmpty()) {
            String[] job = queue.poll();
            int depth = Integer.parseInt(job[2]);
            try (Cursor c = getContext().getContentResolver().query(
                    DocumentsContract.buildChildDocumentsUriUsingTree(tree, job[0]), cols, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    String name = c.getString(1);
                    if (name == null) continue;
                    String path = job[1].isEmpty() ? name : job[1] + "/" + name;
                    if (DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(2))) {
                        if (depth + 1 < MAX_DEPTH) queue.add(new String[]{ c.getString(0), path, String.valueOf(depth + 1) });
                    } else if (isAudio(name)) {
                        if (out.size() >= MAX_FILES) return true;
                        out.add(path);
                    }
                }
            } catch (Exception ignored) { /* 못 읽는 칸은 건너뛴다 */ }
        }
        return false;
    }

    // ── 원본이 있나 ─────────────────────────────────────────────────────

    @PluginMethod
    public void exists(PluginCall call) {
        new Thread(() -> {
            try { existsNow(call); }
            catch (Throwable e) { call.reject("원본을 확인하지 못했습니다: " + e.getMessage()); }
        }, "praise-link-exists").start();
    }

    /** 곡마다 true(있다) · false(없다) · null(모른다 — tojesus 연결이 닿지 않는다. 그때는 🚫 로 바꾸지 않는다) */
    private void existsNow(PluginCall call) {
        JSONArray items = call.getData().optJSONArray("items");
        JSArray out = new JSArray();
        if (items != null) {
            String way = TojesusLink.way(getContext());
            File auto = "auto".equals(way) ? TojesusLink.autoRoot(getContext()) : null;
            Uri picked = "picked".equals(way) ? TojesusLink.pickedTree(getContext()) : null;
            String pickedRoot = TojesusLink.pickedRoot(getContext());
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                Object ok = false;
                if (it != null) {
                    String at = it.optString("at"), path = it.optString("path");
                    if ("link".equals(at)) ok = PraiseLink.exists(getContext(), it.optString("loc"), path);
                    else if ("tj".equals(at)) ok = way == null ? JSONObject.NULL : (Object) (TojesusLink.safeRel(path) && tjExists(auto, picked, pickedRoot, path));
                }
                out.put(ok);
            }
        }
        call.resolve(new JSObject().put("ok", out));
    }

    private boolean tjExists(File auto, Uri picked, String pickedRoot, String path) {
        try {
            if (auto != null) return TojesusLink.child(auto, "praise/" + path).isFile();
        } catch (IOException e) { return false; }
        if (picked == null || pickedRoot == null) return false;
        try (Cursor c = getContext().getContentResolver().query(
                DocumentsContract.buildDocumentUriUsingTree(picked, pickedRoot + "/praise/" + path),
                new String[]{ DocumentsContract.Document.COLUMN_DOCUMENT_ID }, null, null, null)) {
            return c != null && c.moveToFirst();
        } catch (Exception e) {
            return false;
        }
    }

    // ── 자잘한 것 ───────────────────────────────────────────────────────

    private String nameOf(Uri tree) {
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor c = getContext().getContentResolver().query(doc,
                    new String[]{ DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
            }
        } catch (Exception ignored) { /* 이름을 몰라도 쓸 수 있다 */ }
        return "고른 폴더";
    }

    private static boolean isAudio(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        return n.endsWith(".mp3") || n.endsWith(".m4a") || n.endsWith(".aac") || n.endsWith(".ogg")
            || n.endsWith(".opus") || n.endsWith(".wav") || n.endsWith(".flac");
    }
}
