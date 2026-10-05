package com.jonathan.biblemem;

// ============================================================================
// BgPlay — 웹(js/bg-play.js)이 BgPlayService 를 켜고 끄는 문
// ============================================================================
//   BgPlay.start({ title, canPrev })   재생이 시작되거나 곡이 바뀔 때 (이미 돌면 곡 이름만 바꾼다)
//                                      canPrev — 이 화면에 이전 곡이 있으면 ⏮ 를 보인다
//   BgPlay.paused({ position, duration })     멈췄을 때 — 알림 단추를 ▶ 로
//   BgPlay.progress({ position, duration })   곡 길이를 알게 됐거나 건너뛰었을 때 — 잠금화면 진행 막대
//       (start 에도 position·duration 을 함께 보낸다. 모두 밀리초)
//   BgPlay.idle()             화면이 꺼진 채 오래 멈췄을 때 — 알림은 두고 CPU 잠금만 푼다
//   BgPlay.stop()             재생을 멈췄을 때·페이지를 떠날 때
//   addListener("action", ({ action }) => …)
//       알림 단추·잠금화면·이어폰에서 "toggle" · "play" · "pause" · "next" · "prev"
//       · "seek"(잠금화면 진행 막대를 끌었을 때 — value 에 밀리초)
// ============================================================================

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BgPlay")
public class BgPlayPlugin extends Plugin {

    @Override
    public void load() {
        BgPlayService.listener = (action, value) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            data.put("value", value);
            notifyListeners("action", data);
        };
    }

    @PluginMethod
    public void start(PluginCall call) {
        try {
            BgPlayService.start(getContext(), call.getString("title", ""), call.getBoolean("canPrev", false),
                    pos(call), dur(call));
            call.resolve();
        } catch (Exception e) {
            // 안드로이드 12+ 에서 화면 뒤에 있을 때 새로 켜려 하면 여기로 온다
            call.reject("백그라운드 재생을 켜지 못했습니다: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void paused(PluginCall call) {
        BgPlayService.showPaused(pos(call), dur(call));
        call.resolve();
    }

    @PluginMethod
    public void progress(PluginCall call) {
        BgPlayService.progress(pos(call), dur(call));
        call.resolve();
    }

    // 웹은 밀리초 정수로 보낸다. 없으면 위치는 모름(-1), 길이는 0
    private static long pos(PluginCall call) { Double v = call.getDouble("position"); return v == null ? -1 : Math.round(v); }
    private static long dur(PluginCall call) { Double v = call.getDouble("duration"); return v == null ? 0 : Math.round(v); }

    @PluginMethod
    public void idle(PluginCall call) {
        BgPlayService.idle();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        BgPlayService.stop(getContext());
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        BgPlayService.listener = null;
        BgPlayService.stop(getContext());
    }
}
