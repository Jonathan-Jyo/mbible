package com.jonathan.biblemem;

// ============================================================================
// LifeLog — 앱이 갑자기 꺼졌을 때, 그 직전의 메모리 사정을 남긴다 (v4.33.6, 소형폰 판)
// ============================================================================
// S45 Pro(안드로이드 10 · 2GB)에서 성경읽기·매일찬양 중 앱이 꺼지는데 아무 기록도 남지 않았다 — 화면 부품만이
// 아니라 앱 전체가 정리되면 앱이 적을 틈이 없다. USB 로그도 볼 수 없어(폰이 맥에 잡히지 않음), 앱이 미리 적어 둔다.
//
//   · BEAT_MS 마다 「살아 있음」 — 시각 · 폰의 남은 메모리 · 메모리 부족 신호(lowMemory) · 이 앱이 쓰는 메모리(PSS)
//     · 안드로이드가 보낸 마지막 「메모리를 줄여라」 단계(onTrimMemory) · 화면에 있었나 · 소리를 틀고 있었나 · 보던 화면
//   · 앱이 정상으로 닫히면(finish) 「깨끗이 닫힘」을 적는다
//   · 꺼지기 전 3분의 흐름(hist: 5초마다 이 앱 MB · 남은 MB · 부족 신호) — v4.33.7
//   · 다음에 새로 켜질 때(새 프로세스) 마지막 「살아 있음」이 깨끗이 닫힌 것이 아니면 → 「앱이 갑자기 꺼짐」 기록을
//     RendererGuard 의 꺼짐 목록에 더한다(who: "app") — 알림 띠·진단 화면이 그대로 보인다
// ============================================================================

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayDeque;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class LifeLog {

    private LifeLog() {}

    private static final String PREF = "life_log", K_BEAT = "beat";
    private static final long BEAT_MS = 5_000L;
    private static final long MB = 1024L * 1024L;
    /** 꺼지기 전 흐름으로 남길 「살아 있음」 수 — 5초 × 36 = 3분 (v4.33.7) */
    private static final int HIST_KEEP = 36;
    /** [시각(초), 이 앱 MB, 남은 MB, 부족 신호 0/1] — 메인 스레드에서만 만진다 */
    private static final ArrayDeque<long[]> HIST = new ArrayDeque<>();

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    /** 이 프로세스에서 이미 시작했나 — recreate 로 화면만 새로 만든 것은 「새로 켜짐」이 아니다 */
    private static boolean started;
    private static Runnable beat;
    private static volatile boolean foreground;
    private static volatile int lastTrim = -1;
    private static volatile long lastTrimAt;

    static boolean enabled(Context c) { return c.getPackageName().endsWith(".mini"); }

    // ── 그림을 소프트웨어로 그리기(시험, v4.33.7) ──
    // S45 Pro 에서 성경읽기 중 이 앱 몫이 834MB 까지 불어났다. 그래픽 칩(PowerVR SGX)·드라이버가 그림 메모리를
    // 돌려주지 않는 것으로 의심 — 켜면 앞 화면을 그래픽 칩 없이 그린다. 진단 화면에서 켜고 끈다
    private static final String K_SOFT = "soft_render";

    static boolean softRender(Context c) { return enabled(c) && prefs(c).getBoolean(K_SOFT, false); }

    static void setSoftRender(Context c, boolean on) { prefs(c).edit().putBoolean(K_SOFT, on).commit(); }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREF, 0); }

    /** MainActivity.onCreate — 새 프로세스면 지난번이 갑자기 꺼졌는지 보고, 「살아 있음」을 돌린다 */
    static void start(Activity a, WebView web) {
        if (!enabled(a)) return;
        Context c = a.getApplicationContext();
        if (!started) {
            started = true;
            checkLastExit(c);
        }
        if (beat != null) MAIN.removeCallbacks(beat);
        beat = new Runnable() {
            @Override public void run() {
                write(c, web, false);
                MAIN.postDelayed(this, BEAT_MS);
            }
        };
        MAIN.post(beat);
    }

    static void setForeground(Context c, boolean fg, WebView web) {
        if (!enabled(c)) return;
        foreground = fg;
        write(c.getApplicationContext(), web, false);
    }

    static void trim(Context c, int level, WebView web) {
        if (!enabled(c)) return;
        lastTrim = level;
        lastTrimAt = System.currentTimeMillis();
        write(c.getApplicationContext(), web, false);
    }

    /** 앱이 정상으로 닫힐 때(finish) — 다음에 켜져도 「갑자기 꺼짐」으로 치지 않는다 */
    static void cleanExit(Context c, WebView web) {
        if (!enabled(c)) return;
        if (beat != null) MAIN.removeCallbacks(beat);
        beat = null;
        write(c.getApplicationContext(), web, true);
    }

    private static void write(Context c, WebView web, boolean clean) {
        try {
            JSONObject o = snapshot(c);
            o.put("fg", foreground).put("clean", clean).put("playing", BgPlayService.isActive());
            addHist(o);
            JSONArray h = new JSONArray();
            for (long[] e : HIST) h.put(new JSONArray().put(e[0]).put(e[1]).put(e[2]).put(e[3]));
            o.put("hist", h);
            String url = web != null ? web.getUrl() : null;
            o.put("url", url != null ? url : "");
            // 갑자기 꺼지면 다음 줄이 없다 — 곧바로 쓴다
            prefs(c).edit().putString(K_BEAT, o.toString()).commit();
        } catch (JSONException | RuntimeException ignored) { /* 적지 못해도 앱은 그대로 */ }
    }

    /** 지금 메모리 사정 — 진단 화면도 쓴다 */
    static JSONObject snapshot(Context c) throws JSONException {
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        if (am != null) am.getMemoryInfo(mi);
        return new JSONObject()
            .put("at", System.currentTimeMillis())
            .put("availMB", mi.availMem / MB)
            .put("totalMB", mi.totalMem / MB)
            .put("thresholdMB", mi.threshold / MB)
            .put("low", mi.lowMemory)
            .put("pssMB", rssKB() / 1024L)   // 이름은 그대로(진단 화면이 읽는다) — 값은 실제로 차지한 몫(VmRSS)
            .put("trim", lastTrim)
            .put("trimAt", lastTrimAt);
    }

    private static synchronized void addHist(JSONObject o) {
        HIST.addLast(new long[] { o.optLong("at") / 1000L, o.optLong("pssMB"), o.optLong("availMB"), o.optBoolean("low") ? 1 : 0 });
        while (HIST.size() > HIST_KEEP) HIST.removeFirst();
    }

    /**
     * 이 앱이 실제로 차지한 메모리(KB) — /proc/self/status 의 VmRSS.
     * Debug.getPss() 는 이 폰(memtrack 없음)에서 부를 때마다 경고를 남겨 앱 로그를 덮었다(v4.33.6) — 그래서 바꿨다
     */
    static long rssKB() {
        try (BufferedReader r = new BufferedReader(new FileReader("/proc/self/status"))) {
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith("VmRSS:")) return Long.parseLong(line.replaceAll("[^0-9]", ""));
            }
        } catch (IOException | NumberFormatException ignored) { /* 못 읽으면 0 */ }
        return 0L;
    }

    private static void checkLastExit(Context c) {
        String s = prefs(c).getString(K_BEAT, null);
        if (s == null) return;
        try {
            JSONObject b = new JSONObject(s);
            if (b.optBoolean("clean")) return;
            RendererGuard.recordApp(c, b);
        } catch (JSONException ignored) { /* 망가진 기록은 넘긴다 */ }
    }
}
