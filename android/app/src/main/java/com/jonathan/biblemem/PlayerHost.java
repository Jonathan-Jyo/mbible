package com.jonathan.biblemem;

// ============================================================================
// PlayerHost — 화면을 옮겨도 찬양이 끊기지 않게, 소리를 내는 웹 화면을 따로 하나 둔다
// ============================================================================
// 이 앱은 화면마다 페이지를 새로 연다. 소리를 각 화면이 내면, 화면을 옮기는 순간 소리도 사라진다.
// 그래서 보이지 않는 1픽셀짜리 WebView 를 하나 더 띄워 player.html(재생 엔진)을 올려 둔다.
// 이 WebView 는 페이지를 옮겨도 다시 열리지 않는다.
//
//  · 같은 주소(Capacitor 의 로컬 서버)로 열어서, 앱 화면과 같은 저장소(음원 IndexedDB·
//    곡 목록 localStorage)를 그대로 읽는다 — 음원을 옮기거나 바꿀 것이 없다
//  · 화면 → 엔진: BgPlay.engine({cmd, args}) → command() → 엔진의 __engineCmd(...)
//  · 엔진 → 화면: NativeEngine.post(상태) → BgPlayPlugin 이 "engine" 알림으로 지금 화면에 전한다
//  · 엔진 → 알림 줄·잠금화면: NativeEngine.bgStart/… → BgPlayService (js/bg-play.js 가 부른다)
//  · 알림 줄·잠금화면·이어폰 단추 → 엔진의 __bgAction(...)
//  · 엔진이 준비되기 전에 온 명령은 모아 두었다가 준비되면 차례로 보낸다
// ============================================================================

import android.annotation.SuppressLint;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class PlayerHost {

    private static final String PAGE = "player.html";

    static volatile PlayerHost instance;

    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<String> pending = new ArrayList<>();   // 메인 스레드에서만 만진다
    private boolean ready;                                    // 메인 스레드에서만 만진다

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private PlayerHost(MainActivity activity, Bridge bridge) {
        web = new WebView(activity);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // 곡이 끝나면 손대지 않아도 다음 곡을 튼다
        web.setWebViewClient(new WebViewClient() {
            // 앱 화면과 같은 주소·같은 파일을 쓰도록 Capacitor 의 로컬 서버에 맡긴다
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return bridge.getLocalServer().shouldInterceptRequest(request);
            }
        });
        web.addJavascriptInterface(new Engine(), "NativeEngine");
        // 화면이 꺼져도 먼저 정리되지 않게(MainActivity 의 앱 화면과 같은 대접)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        // 보이지 않게 — 1픽셀, 투명, 앱 화면 아래에 깔아 손가락이 닿지 않게
        web.setAlpha(0f);
        web.setFocusable(false);
        web.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        ViewGroup root = activity.findViewById(android.R.id.content);
        root.addView(web, 0, new FrameLayout.LayoutParams(1, 1));

        BgPlayService.listener = (action, value) -> evaluate(
                "window.__bgAction&&window.__bgAction({action:" + JSONObject.quote(action) + ",value:" + value + "})");
        web.loadUrl(bridge.getAppUrl().replaceAll("/+$", "") + "/" + PAGE);
    }

    /** MainActivity 가 앱 화면을 만든 뒤 한 번 부른다 */
    static void start(MainActivity activity, Bridge bridge) {
        if (instance != null || bridge == null) return;
        instance = new PlayerHost(activity, bridge);
    }

    static void destroy() {
        PlayerHost h = instance;
        instance = null;
        if (h == null) return;
        BgPlayService.listener = null;
        h.main.post(() -> {
            ViewGroup parent = (ViewGroup) h.web.getParent();
            if (parent != null) parent.removeView(h.web);
            h.web.destroy();
        });
    }

    /** 화면이 보낸 명령 — {"cmd":…, "args":{…}} */
    void command(String json) {
        main.post(() -> {
            String js = "window.__engineCmd&&window.__engineCmd(" + json + ")";
            if (ready) web.evaluateJavascript(js, null);
            else pending.add(js);
        });
    }

    private void evaluate(String js) {
        main.post(() -> web.evaluateJavascript(js, null));
    }

    /** player.html 이 부르는 길. JavascriptInterface 는 WebView 의 일꾼 스레드에서 불린다 */
    private class Engine {
        @JavascriptInterface
        public void ready() {
            main.post(() -> {
                ready = true;
                for (String js : pending) web.evaluateJavascript(js, null);
                pending.clear();
            });
        }

        @JavascriptInterface
        public void post(String stateJson) {
            BgPlayPlugin p = BgPlayPlugin.instance;
            if (p == null) return;   // 앱 화면이 아직(또는 이미) 없다 — 다음 화면이 hello 로 다시 묻는다
            try { p.emitEngine(new JSObject(stateJson)); }
            catch (Exception e) { android.util.Log.w("PlayerHost", "상태를 화면에 전하지 못했습니다", e); }
        }

        // 알림 줄·잠금화면 — 실패하면 그 까닭을, 되면 빈 문자열을 돌려준다(JS 쪽이 Promise 로 바꾼다)
        @JavascriptInterface
        public String bgStart(String json) {
            return guard(() -> {
                JSONObject o = new JSONObject(json);
                BgPlayService.start(web.getContext(), o.optString("title", ""), o.optBoolean("canPrev", false),
                        pos(o), dur(o));
            });
        }

        @JavascriptInterface
        public String bgPaused(String json) {
            return guard(() -> { JSONObject o = new JSONObject(json); BgPlayService.showPaused(pos(o), dur(o)); });
        }

        @JavascriptInterface
        public String bgProgress(String json) {
            return guard(() -> { JSONObject o = new JSONObject(json); BgPlayService.progress(pos(o), dur(o)); });
        }

        @JavascriptInterface
        public String bgIdle() { return guard(BgPlayService::idle); }

        @JavascriptInterface
        public String bgStop() { return guard(() -> BgPlayService.stop(web.getContext())); }
    }

    private interface Task { void run() throws Exception; }

    private static String guard(Task t) {
        try { t.run(); return ""; }
        catch (Exception e) { return e.getClass().getSimpleName() + ": " + e.getMessage(); }
    }

    // 웹은 밀리초로 보낸다. 없으면 위치는 모름(-1), 길이는 0 — BgPlayPlugin 과 같은 규칙
    private static long pos(JSONObject o) { return o.has("position") ? Math.round(o.optDouble("position", -1)) : -1; }
    private static long dur(JSONObject o) { return o.has("duration") ? Math.round(o.optDouble("duration", 0)) : 0; }
}
