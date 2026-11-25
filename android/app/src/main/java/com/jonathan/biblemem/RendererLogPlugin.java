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
