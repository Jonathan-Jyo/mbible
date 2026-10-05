package com.jonathan.biblemem;

// ============================================================================
// BgPlay — 웹(js/bg-play.js)이 BgPlayService 를 켜고 끄는 문
// ============================================================================
//   BgPlay.start({ title })   재생이 시작되거나 곡이 바뀔 때 (이미 돌면 곡 이름만 바꾼다)
//   BgPlay.idle()             화면이 꺼진 채 멈췄을 때 — 알림은 두고 CPU 잠금만 푼다
//   BgPlay.stop()             재생을 멈췄을 때·페이지를 떠날 때
// ============================================================================

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BgPlay")
public class BgPlayPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        try {
            BgPlayService.start(getContext(), call.getString("title", ""));
            call.resolve();
        } catch (Exception e) {
            // 안드로이드 12+ 에서 화면 뒤에 있을 때 새로 켜려 하면 여기로 온다
            call.reject("백그라운드 재생을 켜지 못했습니다: " + e.getMessage(), e);
        }
    }

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
        BgPlayService.stop(getContext());
    }
}
