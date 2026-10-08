package com.jonathan.biblemem;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 폴더 통째 읽기(SAF) — super.onCreate 앞에서 등록해야 한다
        registerPlugin(HymnTreePlugin.class);
        // 화면이 꺼져도 찬양이 이어지게 (BgPlayService)
        registerPlugin(BgPlayPlugin.class);
        // 정한 시각에 찬양이 울리는 알람 (PraiseAlarm · AlarmService)
        registerPlugin(PraiseAlarmPlugin.class);
        super.onCreate(savedInstanceState);
        // WebView 의 그림·소리를 맡은 일꾼(렌더러)은 기본값으로는 화면이 안 보이면 '아무 때나
        // 정리해도 되는 것'으로 내려간다. 그것이 정리되면 소리가 끊기고 앱 화면까지 닫힌다.
        // 앱 본체와 같은 대접을 받게 묶어 둔다 — 찬양이 도는 동안 앱 본체는 BgPlayService 가 지킨다.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getBridge() != null) {
            getBridge().getWebView().setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        // 화면을 옮겨도 찬양이 끊기지 않게 — 소리는 따로 띄운 엔진 화면이 낸다 (PlayerHost)
        PlayerHost.start(this, getBridge());
        openFromAlarm(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openFromAlarm(intent);
    }

    // 앱을 열었으면 깨어난 것이다 — 울리던 찬양 알람은 멈춘다(앱 안에서 이어 들으면 된다)
    @Override
    public void onResume() {
        super.onResume();
        if (AlarmService.isRinging()) AlarmService.stop();
    }

    /** 알람 알림을 눌러 들어왔으면 그 알람이 정한 화면으로 가서 이어 튼다(praise.html?autoplay=… · pray.html?autoplay=…) */
    private void openFromAlarm(Intent intent) {
        String page = intent == null ? null : intent.getStringExtra(AlarmService.EXTRA_OPEN);
        if (page == null || getBridge() == null) return;
        // 최근 앱 목록에서 되살린 것이면 그 옛 알람 신호로 또 틀지 않는다
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        intent.removeExtra(AlarmService.EXTRA_OPEN);   // 화면을 돌리거나 다시 열 때 또 가지 않게
        AlarmService.stop();
        // 앱 안의 화면 주소만 — 이상한 값이 와도 앱 밖으로 나가지 않게
        if (!page.matches("[a-z]+\\.html(\\?[A-Za-z0-9%=&._:-]*)?")) return;
        String url = getBridge().getAppUrl().replaceAll("/+$", "") + "/" + page;
        WebView web = getBridge().getWebView();
        web.post(() -> web.loadUrl(url));
    }

    @Override
    public void onDestroy() {
        PlayerHost.destroy();
        super.onDestroy();
    }
}
