package com.jonathan.biblemem;

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
        super.onCreate(savedInstanceState);
        // WebView 의 그림·소리를 맡은 일꾼(렌더러)은 기본값으로는 화면이 안 보이면 '아무 때나
        // 정리해도 되는 것'으로 내려간다. 그것이 정리되면 소리가 끊기고 앱 화면까지 닫힌다.
        // 앱 본체와 같은 대접을 받게 묶어 둔다 — 찬양이 도는 동안 앱 본체는 BgPlayService 가 지킨다.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getBridge() != null) {
            getBridge().getWebView().setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }
}
