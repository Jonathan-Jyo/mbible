package com.jonathan.biblemem;

// ============================================================================
// TojesusLink — tojesus 연결 정보를 한 곳에서 (v5.29.0, 설계 11항)
// ============================================================================
// 연결은 둘 중 하나다.
//   picked  사람이 폴더를 골랐다(SAF) — { tree, root }. **있으면 이것이 먼저**
//   auto    「모든 파일 접근」을 허락받아 내장·SD카드 맨 위의 tojesus 를 찾았다 — { path }
// 재등록·말씀듣기·그 장 듣기·찬미가가 모두 여기 하나를 본다(TojesusFolder · TojesusMedia · HymnTree).
// 고른 폴더의 권한이 거둬졌거나 SD카드가 빠졌으면 자동 길로 물러선다.
// ============================================================================

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.DocumentsContract;

import androidx.core.content.ContextCompat;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

final class TojesusLink {

    private TojesusLink() {}

    static final String PREF = "tojesus_folder";
    static final String K_TREE = "tree", K_ROOT = "root", K_AUTO = "auto_path";
    static final String ROOT_NAME = "tojesus";
    /** 자동 연결을 다른 부품에 넘길 때 쓰는 이름표 — 「file:」 + 절대 경로 */
    static final String FILE_TAG = "file:";

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREF, 0); }

    // ── 모든 파일 접근 ──────────────────────────────────────────────────

    /** 공용 저장소를 파일 길로 읽을 수 있나 — 11+ 는 「모든 파일 접근」, 10 이하는 저장소 권한 */
    static boolean allFiles(Context c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Environment.isExternalStorageManager();
        return ContextCompat.checkSelfPermission(c, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    /** 파일 길로 쓸 수 있나 — 10 이하는 쓰기 권한이 따로다 */
    static boolean allFilesWrite(Context c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Environment.isExternalStorageManager();
        return ContextCompat.checkSelfPermission(c, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    /** 이 tojesus 에 파일 길로 쓸 수 있나 (v5.29.1).
     *  11+ 「모든 파일 접근」은 SD카드까지 쓴다. 10 이하는 쓰기 권한이 있어도 **이동식 SD카드에는 못 쓴다**
     *  (4.4 부터 — 앱 전용 폴더와 SAF 로 고른 폴더만). 그때는 읽기·재생만 파일 길로 하고, 쓰기는 폴더 고르기로 안내한다 */
    static boolean canWrite(Context c, File root) {
        if (!allFilesWrite(c)) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return true;
        return root != null && onPrimary(root);
    }

    /** 내장 저장소(기본 공용 저장소) 안인가 */
    static boolean onPrimary(File root) {
        File primary = Environment.getExternalStorageDirectory();
        return primary != null && root.getAbsolutePath().startsWith(primary.getAbsolutePath() + "/");
    }

    // ── 고른 폴더(SAF) ──────────────────────────────────────────────────

    /** 살아 있는 고른 연결 — 권한이 거둬졌거나 그 폴더가 없어졌으면(지움·SD카드 바꿈) null.
     *  status() 와 다른 손발이 같은 판정을 쓰게 여기 한 곳에서 본다 — 어긋나면 「자동」이라 알리고 죽은 폴더를 읽는다 */
    static Uri pickedTree(Context c) {
        String t = prefs(c).getString(K_TREE, null), root = prefs(c).getString(K_ROOT, null);
        if (t == null || root == null) return null;
        Uri tree = Uri.parse(t);
        boolean read = false;
        for (UriPermission p : c.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isReadPermission()) read = true;
        }
        if (!read) return null;
        try (Cursor cur = c.getContentResolver().query(DocumentsContract.buildDocumentUriUsingTree(tree, root),
                new String[]{ DocumentsContract.Document.COLUMN_DOCUMENT_ID }, null, null, null)) {
            return cur != null && cur.moveToFirst() ? tree : null;
        } catch (Exception e) {
            return null;
        }
    }

    static String pickedRoot(Context c) { return prefs(c).getString(K_ROOT, null); }

    static boolean hasPicked(Context c) { return prefs(c).getString(K_TREE, null) != null; }

    // ── 자동(파일 길) ───────────────────────────────────────────────────

    /** 자동으로 찾아 둔 tojesus — 허락이 없거나 폴더가 없으면 null */
    static File autoRoot(Context c) {
        String p = prefs(c).getString(K_AUTO, null);
        if (p == null || !allFiles(c)) return null;
        File f = new File(p);
        return f.isDirectory() ? f : null;
    }

    /** 지금 쓸 길 — "picked" · "auto" · null. 고른 것이 살아 있으면 그것이 먼저 */
    static String way(Context c) {
        if (pickedTree(c) != null) return "picked";
        if (autoRoot(c) != null) return "auto";
        return null;
    }

    /** 저장소 뿌리들 — 내장이 먼저, 그다음 SD카드·USB */
    static List<File> volumeRoots(Context c) {
        List<File> out = new ArrayList<>();
        File primary = Environment.getExternalStorageDirectory();
        if (primary != null) out.add(primary);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            StorageManager sm = (StorageManager) c.getSystemService(Context.STORAGE_SERVICE);
            if (sm != null) {
                for (StorageVolume v : sm.getStorageVolumes()) {
                    File d = v.getDirectory();
                    if (d != null && !containsPath(out, d)) out.add(d);
                }
            }
        } else {
            // 10 이하 — 앱 전용 폴더(…/Android/data/<앱>/files) 의 앞부분이 그 저장소의 뿌리다
            for (File d : c.getExternalFilesDirs(null)) {
                if (d == null) continue;
                String s = d.getAbsolutePath();
                int cut = s.indexOf("/Android/data/");
                if (cut > 0) {
                    File r = new File(s.substring(0, cut));
                    if (!containsPath(out, r)) out.add(r);
                }
            }
        }
        return out;
    }

    private static boolean containsPath(List<File> list, File f) {
        for (File x : list) if (x.getAbsolutePath().equals(f.getAbsolutePath())) return true;
        return false;
    }

    /** 뿌리 바로 아래의 tojesus(대소문자 무시) */
    static File findIn(File volume) {
        File[] kids = volume.listFiles();
        if (kids == null) return null;
        for (File k : kids) if (k.isDirectory() && ROOT_NAME.equalsIgnoreCase(k.getName())) return k;
        return null;
    }

    /** 사람이 이름 붙인 저장소 — 내장 저장소 / SD카드 */
    static String whereOf(Context c, File root) {
        return onPrimary(root) ? "내장 저장소" : "SD카드";
    }

    // ── 경로 ───────────────────────────────────────────────────────────

    /** 폴더 밖으로 나가는 경로(.. · 맨 앞 /)를 막는다 */
    static boolean safeRel(String rel) {
        if (rel == null || rel.isEmpty() || rel.startsWith("/")) return false;
        for (String s : rel.split("/")) if (!safeSeg(s)) return false;
        return true;
    }

    static boolean safeSeg(String s) {
        return s != null && !s.isEmpty() && !s.equals(".") && !s.equals("..") && s.length() <= 200
            && s.indexOf('\\') < 0 && s.indexOf('\0') < 0;
    }

    /** root 아래 rel 의 파일 — 이음(심볼릭 링크) 등으로 root 밖이 되면 IOException */
    static File child(File root, String rel) throws IOException {
        if (!safeRel(rel)) throw new IOException("경로가 올바르지 않습니다");
        File f = new File(root, rel);
        String base = root.getCanonicalPath() + File.separator;
        if (!f.getCanonicalPath().startsWith(base)) throw new IOException("경로가 올바르지 않습니다");
        return f;
    }
}
