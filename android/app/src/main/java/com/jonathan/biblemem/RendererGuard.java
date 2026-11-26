package com.jonathan.biblemem;

// ============================================================================
// RendererGuard — WebView 의 화면 일꾼(렌더러)이 죽어도 앱이 함께 꺼지지 않게 (v5.33.3 · 3.33.3 · 4.33.3)
// ============================================================================
// 안드로이드 8 부터 렌더러가 죽었을 때 그 렌더러를 쓰던 WebView 가 **모두** onRenderProcessGone 에서 true 를
// 돌려주지 않으면 앱 전체를 끈다(「Render process's crash wasn't handled by all associated webviews」).
// 이 앱은 WebView 가 둘(앞 화면 + 숨은 재생 화면 PlayerHost)이고 한 렌더러를 함께 쓴다 — 둘 다 여기로 받는다.
// S45 Pro(안드로이드 10 · WebView 74 · 2GB)에서 성경을 읽다 앱이 꺼진 일(2026-11-26)이 이것이었다.
//
//   record(...)  까닭을 적어 둔다 — 충돌(didCrash)인지, 메모리가 모자라 안드로이드가 정리한 것인지 + 그때 우선순위·화면·시각
//   list()       적어 둔 것(최근 10개) — Diag 플러그인이 화면에 넘긴다
//   safeMode()      1분 안에 두 번째 꺼짐부터는 진단 화면(diag.html?gone=n)으로 연다 — 숨은 재생 화면도 띄우지 않는다 (v4.33.4)
//   allowRestart()  그래도 거듭 죽으면 다시 열지 않는다(열자마자 죽는 기기에서 끝없이 되풀이하지 않게)
// ============================================================================

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class RendererGuard {

    private RendererGuard() {}

    private static final String PREF = "renderer_guard", K_LOG = "log", K_SEEN = "seen", K_REOPEN = "reopen";
    /** 다시 열 화면 주소는 이 시간 안에만 쓴다 */
    private static final long REOPEN_MS = 30_000L;
    private static final int KEEP = 10;
    /** 이 시간 안에 RESTART_MAX 번 넘게 죽으면 다시 열지 않는다 */
    private static final long RESTART_WINDOW_MS = 60_000L;
    private static final int RESTART_MAX = 3;

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREF, 0); }

    /** 렌더러가 죽은 까닭을 적는다. who: "main"(앞 화면) · "player"(숨은 재생 화면) */
    static synchronized void record(Context c, String who, WebView view, RenderProcessGoneDetail d) {
        try {
            JSONObject o = new JSONObject()
                .put("at", System.currentTimeMillis())
                .put("who", who)
                .put("crash", d != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && d.didCrash())
                .put("priority", d != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? d.rendererPriorityAtExit() : -1)
                .put("url", view != null && view.getUrl() != null ? view.getUrl() : "");
            JSONArray old = list(c), out = new JSONArray();
            out.put(o);
            for (int i = 0; i < old.length() && out.length() < KEEP; i++) out.put(old.get(i));
            prefs(c).edit().putString(K_LOG, out.toString()).commit();   // 곧 화면을 새로 여니 바로 쓴다
        } catch (JSONException ignored) { /* 적지 못해도 앱은 살린다 */ }
    }

    /** 앱 전체가 갑자기 꺼진 일(LifeLog 가 다음에 켜질 때 알아챈다) — 마지막 「살아 있음」을 그대로 적는다 (v4.33.6) */
    static synchronized void recordApp(Context c, JSONObject lastBeat) {
        try {
            JSONObject o = new JSONObject(lastBeat.toString()).put("who", "app").put("crash", false).put("priority", -1);
            JSONArray old = list(c), out = new JSONArray();
            out.put(o);
            for (int i = 0; i < old.length() && out.length() < KEEP; i++) out.put(old.get(i));
            prefs(c).edit().putString(K_LOG, out.toString()).commit();
        } catch (JSONException ignored) { /* 적지 못해도 앱은 연다 */ }
    }

    static synchronized JSONArray list(Context c) {
        try { return new JSONArray(prefs(c).getString(K_LOG, "[]")); }
        catch (JSONException e) { return new JSONArray(); }
    }

    /** 죽은 WebView 를 화면에서 떼어 낸다(그 뒤 destroy 는 부르는 쪽이) */
    static void detach(WebView v) {
        if (v != null && v.getParent() instanceof ViewGroup) ((ViewGroup) v.getParent()).removeView(v);
    }

    static synchronized void clear(Context c) { prefs(c).edit().remove(K_LOG).remove(K_SEEN).apply(); }

    /** 아직 알리지 않은 기록 — 돌려준 뒤 「알렸음」으로 친다 */
    static synchronized JSONArray takeUnseen(Context c) {
        long seen = prefs(c).getLong(K_SEEN, 0L);
        JSONArray a = list(c), out = new JSONArray();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && o.optLong("at") > seen) out.put(o);
        }
        prefs(c).edit().putLong(K_SEEN, System.currentTimeMillis()).apply();
        return out;
    }

    /** 죽은 앞 화면의 주소를 적어 둔다 — 새로 만든 화면이 그리로 다시 간다(읽던 장으로) */
    static synchronized void markReopen(Context c, String url) {
        if (url == null || url.isEmpty()) return;
        prefs(c).edit().putString(K_REOPEN, System.currentTimeMillis() + " " + url).commit();
    }

    /** 다시 갈 주소(30초 안에 적은 것만) — 한 번 꺼내면 지운다 */
    static synchronized String takeReopen(Context c) {
        String v = prefs(c).getString(K_REOPEN, null);
        if (v == null) return null;
        prefs(c).edit().remove(K_REOPEN).apply();
        int sp = v.indexOf(' ');
        if (sp < 0) return null;
        try {
            long at = Long.parseLong(v.substring(0, sp));
            return System.currentTimeMillis() - at < REOPEN_MS ? v.substring(sp + 1) : null;
        } catch (NumberFormatException e) { return null; }
    }

    /** 최근 RESTART_WINDOW_MS 안의 「앞 화면」 꺼짐 횟수(방금 적은 것 포함) */
    static synchronized int recentMain(Context c) {
        JSONArray a = list(c);
        long now = System.currentTimeMillis();
        int n = 0;
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && "main".equals(o.optString("who")) && now - o.optLong("at") < RESTART_WINDOW_MS) n++;
        }
        return n;
    }

    /** 다시 열어도 되나 — RESTART_MAX 번 넘게 꺼졌으면(진단 화면조차 꺼진 것) 닫는다 */
    static boolean allowRestart(int recent) { return recent <= RESTART_MAX; }

    /** 두 번째 꺼짐부터는 읽던 화면 대신 가벼운 진단 화면으로 연다(같은 화면이 또 죽는 되풀이를 끊고, 기록을 보이게) */
    static boolean safeMode(int recent) { return recent >= 2; }
}
