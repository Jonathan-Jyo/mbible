package com.jonathan.biblemem;

// AppExit — 첫화면의 「끝내기」 단추로 앱을 끝낸다 (v5.34.0 · 3.34.0 · 4.35.0, 2026-11-26 대표 요청)
//   exit()  재생(알림 줄·숨은 재생 화면)을 멈추고 화면을 닫아 최근 앱 목록에서도 뺀다.
//           정해 둔 찬양 알람은 그대로 둔다(알람은 안드로이드가 따로 깨운다)

import android.app.Activity;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppExit")
public class AppExitPlugin extends Plugin {

    @PluginMethod
    public void exit(PluginCall call) {
        Activity a = getActivity();
        if (a == null) { call.reject("화면이 없습니다"); return; }
        call.resolve();
        a.runOnUiThread(() -> {
            BgPlayService.stop(a);
            PlayerHost.destroy();
            LifeLog.cleanExit(a, null);   // 갑자기 꺼짐으로 적히지 않게
            a.finishAndRemoveTask();
        });
    }
}
