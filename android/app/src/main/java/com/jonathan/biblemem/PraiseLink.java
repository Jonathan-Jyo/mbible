package com.jonathan.biblemem;

// ============================================================================
// PraiseLink — 매일찬양 「위치 등록」 (v5.30.0, 설계 14항)
// ============================================================================
// 사용자 음악 폴더의 곡을 **복사하지 않고 자리만** 등록해 그곳에서 튼다.
// 사람이 고른 폴더(SAF) 하나가 「위치」 하나다 — 번호(L1, L2 …)를 붙여 여기 기억한다.
//   곡은 { at: "link", loc: "L1", path: "<그 위치 기준 상대 경로>" } 로 매일찬양 곡 목록에 남는다.
//   재생 주소는 /_praiselink_/L1/<상대 경로> — TojesusMedia 가 받아 그 자리에서 흘려 준다.
//
//  · 등록된 위치 **아래만** 연다(TojesusLink.child · safeRel). 아무 경로나 열지 않는다
//  · 「모든 파일 접근」이 있고 그 폴더의 파일 경로를 알 수 있으면 파일 길(빠르다), 아니면 고른 폴더(SAF) 길
//  · 원본을 사람이 지우거나 옮기면 그 곡은 열리지 않는다(404) — 화면이 🚫 와 「위치 다시 찾기」를 보인다
// ============================================================================

import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;

final class PraiseLink {

    private PraiseLink() {}

    static final String PREFIX = "/_praiselink_/";
    private static final String PREF = "praise_link", K_LIST = "locations", K_NEXT = "next";

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREF, 0); }

    // ── 위치 목록 ───────────────────────────────────────────────────────

    /** [{ id, name, tree, file? }] — 사본을 돌려준다 */
    static synchronized JSONArray list(Context c) {
        try { return new JSONArray(prefs(c).getString(K_LIST, "[]")); }
        catch (JSONException e) { return new JSONArray(); }
    }

    private static synchronized void save(Context c, JSONArray a) {
        prefs(c).edit().putString(K_LIST, a.toString()).apply();
    }

    static JSONObject find(Context c, String id) {
        if (id == null) return null;
        JSONArray a = list(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return o;
        }
        return null;
    }

    /** 고른 폴더를 위치로 — 같은 폴더를 다시 고르면 그 번호를 그대로 돌려준다 */
    static synchronized String add(Context c, Uri tree, String name) {
        JSONArray a = list(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && tree.toString().equals(o.optString("tree"))) return o.optString("id");
        }
        int n = prefs(c).getInt(K_NEXT, 1);
        String id = "L" + n;
        try { a.put(entry(c, id, tree, name)); } catch (JSONException e) { return null; }
        prefs(c).edit().putInt(K_NEXT, n + 1).apply();
        save(c, a);
        return id;
    }

    /** 「위치 다시 찾기」 — 그 번호의 폴더를 새로 고른 폴더로 바꾼다(곡들의 상대 경로는 그대로) */
    static synchronized boolean replace(Context c, String id, Uri tree, String name) {
        JSONArray a = list(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null || !id.equals(o.optString("id"))) continue;
            try { a.put(i, entry(c, id, tree, name)); } catch (JSONException e) { return false; }
            save(c, a);
            return true;
        }
        return false;
    }

    /** 위치를 지운다 — 그 폴더를 다른 위치가 쓰지 않으면 권한도 놓는다. 놓아야 할 tree 를 돌려준다(없으면 null) */
    static synchronized String remove(Context c, String id) {
        JSONArray a = list(c), out = new JSONArray();
        String tree = null;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            if (id.equals(o.optString("id"))) tree = o.optString("tree", null);
            else out.put(o);
        }
        save(c, out);
        if (tree == null) return null;
        for (int i = 0; i < out.length(); i++) if (tree.equals(out.optJSONObject(i).optString("tree"))) return null;
        return tree;
    }

    private static JSONObject entry(Context c, String id, Uri tree, String name) throws JSONException {
        JSONObject o = new JSONObject().put("id", id).put("name", name == null ? "" : name).put("tree", tree.toString());
        String abs = filePathOf(c, tree);
        if (abs != null) o.put("file", abs);
        return o;
    }

    /** 고른 폴더(SAF)의 파일 경로 — 기기 안 저장소 제공자의 「primary:Music/시험」·「1A2B-3C4D:Music」 꼴만. 모르면 null */
    static String filePathOf(Context c, Uri tree) {
        if (!"com.android.externalstorage.documents".equals(tree.getAuthority())) return null;
        String doc;
        try { doc = DocumentsContract.getTreeDocumentId(tree); } catch (Exception e) { return null; }
        int colon = doc.indexOf(':');
        if (colon < 0) return null;
        String vol = doc.substring(0, colon), rel = doc.substring(colon + 1);
        File base = null;
        if ("primary".equals(vol)) base = Environment.getExternalStorageDirectory();
        else for (File r : TojesusLink.volumeRoots(c)) if (r.getName().equalsIgnoreCase(vol)) base = r;
        if (base == null) return null;
        return rel.isEmpty() ? base.getAbsolutePath() : new File(base, rel).getAbsolutePath();
    }

    // ── 열기 ────────────────────────────────────────────────────────────

    /** 파일 길로 쓸 수 있는 위치의 폴더 — 허락이 없거나 폴더가 없으면 null */
    static File fileRoot(Context c, JSONObject loc) {
        String p = loc.optString("file", null);
        if (p == null || p.isEmpty() || !TojesusLink.allFiles(c)) return null;
        File f = new File(p);
        return f.isDirectory() ? f : null;
    }

    /** 읽기 권한이 살아 있는 고른 폴더 — 아니면 null */
    static Uri tree(Context c, JSONObject loc) {
        String t = loc.optString("tree", null);
        if (t == null) return null;
        Uri tree = Uri.parse(t);
        for (UriPermission p : c.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isReadPermission()) return tree;
        }
        return null;
    }

    static boolean treeWritable(Context c, Uri tree) {
        for (UriPermission p : c.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isWritePermission()) return true;
        }
        return false;
    }

    static Uri docOf(Uri tree, String rel) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree) + "/" + rel);
    }

    /** 그 위치 아래 rel 을 읽기로 연다 — 없거나 위치 밖이면 IOException */
    static ParcelFileDescriptor open(Context c, String id, String rel) throws IOException {
        if (!TojesusLink.safeRel(rel)) throw new IOException("경로가 올바르지 않습니다");
        JSONObject loc = find(c, id);
        if (loc == null) throw new IOException("등록된 위치가 아닙니다");
        File root = fileRoot(c, loc);
        if (root != null) {
            File f = TojesusLink.child(root, rel);
            if (f.isFile()) return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
        }
        Uri tree = tree(c, loc);
        if (tree == null) throw new IOException("그 위치를 읽을 권한이 없습니다");
        ParcelFileDescriptor pfd = c.getContentResolver().openFileDescriptor(docOf(tree, rel), "r");
        if (pfd == null) throw new IOException("열지 못했습니다");
        return pfd;
    }

    static InputStream openStream(Context c, String id, String rel) throws IOException {
        return new ParcelFileDescriptor.AutoCloseInputStream(open(c, id, rel));
    }

    static boolean exists(Context c, String id, String rel) {
        if (!TojesusLink.safeRel(rel)) return false;
        JSONObject loc = find(c, id);
        if (loc == null) return false;
        try {
            File root = fileRoot(c, loc);
            if (root != null && TojesusLink.child(root, rel).isFile()) return true;   // 못 찾으면 open() 처럼 고른 폴더로 한 번 더
        } catch (IOException e) { return false; }
        Uri tree = tree(c, loc);
        if (tree == null) return false;
        try (Cursor cur = c.getContentResolver().query(docOf(tree, rel),
                new String[]{ DocumentsContract.Document.COLUMN_DOCUMENT_ID }, null, null, null)) {
            return cur != null && cur.moveToFirst();
        } catch (Exception e) {
            return false;
        }
    }

    /** 그 위치의 rel 을 파일 길로 알 수 있으면 그 파일(정규 경로) — 모르면 null. 이동 전 「원본 = 새 자리」인지 견줄 때 */
    static File fileOf(Context c, String id, String rel) {
        JSONObject loc = find(c, id);
        File root = loc == null ? null : fileRoot(c, loc);
        if (root == null) {
            String p = loc == null ? null : loc.optString("file", null);   // 허락이 없어도 경로는 견줄 수 있다
            if (p == null || p.isEmpty()) return null;
            root = new File(p);
        }
        try { return TojesusLink.child(root, rel).getCanonicalFile(); } catch (IOException e) { return null; }
    }

    /** 원본 지우기(「모으기 › 이동」) — 고른 폴더에 쓰기 권한이 있으면 그 길, 없으면 파일 길(쓸 수 있을 때만) */
    static boolean delete(Context c, String id, String rel) {
        if (!TojesusLink.safeRel(rel)) return false;
        JSONObject loc = find(c, id);
        if (loc == null) return false;
        Uri tree = tree(c, loc);
        if (tree != null && treeWritable(c, tree)) {
            try { if (DocumentsContract.deleteDocument(c.getContentResolver(), docOf(tree, rel))) return true; }
            catch (Exception ignored) { /* 아래 파일 길로 한 번 더 */ }
        }
        File root = fileRoot(c, loc);
        if (root == null || !TojesusLink.allFilesWrite(c)) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R && !TojesusLink.onPrimary(root)) return false;   // 10 이하 SD카드
        try { return TojesusLink.child(root, rel).delete(); }
        catch (IOException e) { return false; }
    }

    /** 이 위치의 원본을 지울 수 있나 — 이동을 고르기 전에 묻는다 */
    static boolean canDelete(Context c, String id) {
        JSONObject loc = find(c, id);
        if (loc == null) return false;
        Uri tree = tree(c, loc);
        if (tree != null && treeWritable(c, tree)) return true;
        File root = fileRoot(c, loc);
        if (root == null || !TojesusLink.allFilesWrite(c)) return false;
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R || TojesusLink.onPrimary(root);
    }
}
