package com.jonathan.biblemem;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    /** 거듭 꺼질 때 여는 가벼운 화면 */
    private static final String SAFE_PAGE = "diag.html";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 폴더 통째 읽기(SAF) — super.onCreate 앞에서 등록해야 한다
        registerPlugin(HymnTreePlugin.class);
        // 화면이 꺼져도 찬양이 이어지게 (BgPlayService)
        registerPlugin(BgPlayPlugin.class);
        // 정한 시각에 찬양이 울리는 알람 (PraiseAlarm · AlarmService)
        registerPlugin(PraiseAlarmPlugin.class);
        // 자료 폴더 tojesus/ 연결 · 훑기 · 압축 흘려 풀기 (docs/tojesus-자료폴더-설계.md)
        registerPlugin(TojesusFolderPlugin.class);
        // 매일찬양 「위치 등록」 — 사용자 폴더의 곡을 복사하지 않고 그 자리에서 (PraiseLink, v5.30.0)
        registerPlugin(PraiseLinkPlugin.class);
        // 화면 일꾼(렌더러)이 죽은 까닭 기록을 화면에 넘긴다 (RendererGuard, v5.33.3)
        registerPlugin(RendererLogPlugin.class);
        super.onCreate(savedInstanceState);
        // WebView 의 그림·소리를 맡은 일꾼(렌더러)은 기본값으로는 화면이 안 보이면 '아무 때나
        // 정리해도 되는 것'으로 내려간다. 그것이 정리되면 소리가 끊기고 앱 화면까지 닫힌다.
        // 앱 본체와 같은 대접을 받게 묶어 둔다 — 찬양이 도는 동안 앱 본체는 BgPlayService 가 지킨다.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getBridge() != null) {
            getBridge().getWebView().setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        // tojesus 폴더의 오디오(/_tojesus_/…)·위치 등록 곡(/_praiselink_/…) — 엔진 화면이 없을 때 이 화면이 직접 틀어도 같은 길로 읽게
        if (getBridge() != null) {
            getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    WebResourceResponse tj = TojesusMedia.serve(MainActivity.this, request);
                    return tj != null ? tj : super.shouldInterceptRequest(view, request);
                }

                // 화면 일꾼(렌더러)이 죽었다 — true 를 돌려주지 않으면 안드로이드가 앱을 통째로 끈다(RendererGuard)
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    RendererGuard.record(MainActivity.this, "main", view, detail);
                    reopenAfterRendererGone(view);
                    return true;
                }
            });
            // 서비스 워커(sw.js)를 거친 요청은 위 길을 지나지 않는다 — 그쪽에도 같은 길을 끼운다
            // (sw.js 는 /_tojesus_/·/_praiselink_/ 를 넘기지만, 업데이트 직후 옛 sw.js 가 아직 돌 수 있다)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                        WebResourceResponse tj = TojesusMedia.serve(MainActivity.this, request);
                        return tj != null ? tj : getBridge().getLocalServer().shouldInterceptRequest(request);
                    }
                });
            }
        }
        // 화면을 옮겨도 찬양이 끊기지 않게 — 소리는 따로 띄운 엔진 화면이 낸다 (PlayerHost)
        String reopen = RendererGuard.takeReopen(this);
        // 거듭 꺼져 진단 화면으로 다시 여는 길이면 숨은 재생 화면을 띄우지 않는다(메모리를 덜 쓰게 — v4.33.4)
        // mini 는 소리를 처음 틀 때 띄운다(PlayerHost.lazy — v4.33.5)
        if ((reopen == null || !reopen.contains(SAFE_PAGE)) && !PlayerHost.lazy(this)) PlayerHost.start(this, getBridge());
        reopenLostPage(reopen);
        // 소형폰 판 — 갑자기 꺼질 때를 대비해 몇 초마다 메모리 사정을 적는다(LifeLog, v4.33.6)
        if (getBridge() != null) LifeLog.start(this, getBridge().getWebView());
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
        LifeLog.setForeground(this, true, web());
    }

    @Override
    public void onPause() {
        LifeLog.setForeground(this, false, web());
        super.onPause();
    }

    /** 안드로이드가 「메모리를 줄여라」고 알릴 때 — 그 단계를 적어 둔다(LifeLog) */
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        LifeLog.trim(this, level, web());
    }

    private WebView web() { return getBridge() != null ? getBridge().getWebView() : null; }

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

    /** 렌더러가 죽어 새로 만든 화면이면, 죽기 전에 보던 화면(또는 진단 화면)으로 간다(앱 안 주소만) */
    private void reopenLostPage(String url) {
        if (url == null || getBridge() == null) return;
        String base = appBase();
        if (!url.startsWith(base) || url.equals(base) || url.startsWith(base + "index.html")) return;
        WebView web = getBridge().getWebView();
        web.post(() -> web.loadUrl(url));
    }

    private String appBase() { return getBridge().getAppUrl().replaceAll("/+$", "") + "/"; }

    /**
     * 죽은 앞 화면을 치우고 앱 화면을 새로 연다.
     * 1분 안 첫 꺼짐 → 보던 화면으로 · 두 번째부터 → 진단 화면으로 · 그래도 거듭 꺼지면 닫는다
     */
    private void reopenAfterRendererGone(WebView dead) {
        int recent = RendererGuard.recentMain(this);
        String back = RendererGuard.safeMode(recent) ? appBase() + SAFE_PAGE + "?gone=" + recent : dead.getUrl();
        RendererGuard.markReopen(this, back);
        RendererGuard.detach(dead);
        dead.destroy();
        PlayerHost.destroy();   // 같은 렌더러를 쓰던 숨은 재생 화면도 함께 치운다(새 화면이 다시 띄운다)
        // recreate — 같은 화면을 새 WebView 로 다시 만든다(앱이 뒤에 있어도 막히지 않는다. 앞에 올 때 만들어진다)
        if (RendererGuard.allowRestart(recent)) recreate();
        else finish();
    }

    @Override
    public void onDestroy() {
        // 사용자가 닫은 것(뒤로 가기로 끝냄)이면 「깨끗이 닫힘」 — recreate 는 아니다
        if (isFinishing()) LifeLog.cleanExit(this, null);
        PlayerHost.destroy();
        super.onDestroy();
    }
}
