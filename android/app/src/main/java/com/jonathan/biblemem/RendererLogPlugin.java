package com.jonathan.biblemem;

// RendererLog — 「화면이 꺼진 까닭」 기록을 웹 화면에 넘긴다 (v5.33.3 · 3.33.3 · 4.33.3)
//   pending()  아직 알리지 않은 기록(화면을 다시 열면 boot-guard.js 가 한 번 알린다) — 부르면 「알렸음」으로 친다
//   list()     최근 기록 10개(diag.html)
//   clear()    기록 지우기

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

@CapacitorPlugin(name = "RendererLog")
public class RendererLogPlugin extends Plugin {

    @PluginMethod
    public void pending(PluginCall call) { send(call, RendererGuard.takeUnseen(getContext())); }

    @PluginMethod
    public void list(PluginCall call) { send(call, RendererGuard.list(getContext())); }

    /** 지금 폰의 메모리 사정(진단 화면) — 남은 · 전체 · 부족 기준 · 부족 신호 · 이 앱 PSS */
    @PluginMethod
    public void memNow(PluginCall call) {
        try { call.resolve(new JSObject(LifeLog.snapshot(getContext()).toString())); }
        catch (Exception e) { call.reject("메모리를 읽지 못했습니다: " + e.getMessage()); }
    }

    /**
     * 이 앱이 남긴 로그 가운데 경고·오류 끝부분(진단 화면) — 앱은 제 몫(같은 uid)만 읽을 수 있다.
     * 안드로이드가 앱을 정리한 기록(시스템 몫)은 보이지 않는다
     */
    @PluginMethod
    public void appLog(PluginCall call) {
        new Thread(() -> {
            StringBuilder sb = new StringBuilder();
            Process p = null;
            try {
                p = new ProcessBuilder("logcat", "-d", "-v", "time", "-t", String.valueOf(LOG_TAIL), "TojesusMedia:V", "*:W")
                        .redirectErrorStream(true).start();
                try (java.io.BufferedReader r = new java.io.BufferedReader(
                        new java.io.InputStreamReader(p.getInputStream(), java.nio.charset.StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line).append('\n');
                }
                JSObject o = new JSObject();
                o.put("text", sb.toString());
                call.resolve(o);
            } catch (Exception e) {
                call.reject("앱 로그를 읽지 못했습니다: " + e.getMessage());
            } finally {
                if (p != null) p.destroy();
            }
        }, "app-log").start();
    }

    private static final int LOG_TAIL = 400;

    /** 그림을 소프트웨어로 그리기(시험) — { on, available } */
    @PluginMethod
    public void softRender(PluginCall call) {
        JSObject o = new JSObject();
        o.put("available", LifeLog.enabled(getContext()));
        o.put("on", LifeLog.softRender(getContext()));
        call.resolve(o);
    }

    /** 켜고 끈다 — 화면을 새로 만들어야 적용된다(진단 화면으로 다시 열린다) */
    @PluginMethod
    public void setSoftRender(PluginCall call) {
        if (!LifeLog.enabled(getContext())) { call.reject("소형폰 판에서만 씁니다"); return; }
        LifeLog.setSoftRender(getContext(), Boolean.TRUE.equals(call.getBoolean("on", false)));
        RendererGuard.markReopen(getContext(), getBridge().getAppUrl().replaceAll("/+$", "") + "/diag.html");
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    @PluginMethod
    public void clear(PluginCall call) {
        RendererGuard.clear(getContext());
        call.resolve();
    }

    private static void send(PluginCall call, org.json.JSONArray a) {
        try {
            JSObject r = new JSObject();
            r.put("items", new JSArray(a.toString()));
            call.resolve(r);
        } catch (JSONException e) {
            call.reject("기록을 읽지 못했습니다: " + e.getMessage());
        }
    }
}
