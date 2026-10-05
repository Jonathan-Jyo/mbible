package com.jonathan.biblemem;

// ============================================================================
// BgPlayService — 화면이 꺼져도 찬양 연속재생이 끊기지 않게 앱을 깨워 둔다
// ============================================================================
// 소리는 여전히 WebView 의 <audio> 가 낸다. 이 서비스는 소리를 내지 않고,
// 안드로이드에 "이 앱은 지금 음악을 틀고 있다"고 알리는 일만 한다.
//
// 이것이 없으면: 화면이 꺼진 뒤 안드로이드가 앱을 '쉬는 앱'으로 보고 몇 곡 뒤
// 얼리거나 정리해 버린다. 그러면 곡이 끝나도 다음 곡으로 넘어가지 못하고,
// WebView 가 통째로 사라지면 앱 화면까지 닫힌다.
//
//  · 알림 한 줄(지금 곡 이름)을 띄우는 '포그라운드 서비스'로 돈다 — 안드로이드가
//    음악 앱으로 대접하는 유일한 길이다. 알림을 누르면 앱으로 돌아온다.
//  · 곡과 곡 사이(다음 음원을 불러오는 몇 순간)에 CPU 가 잠들지 않게 잠금을 쥔다.
//    곡이 바뀔 때마다 시간을 새로 잰다 — 무언가 꼬여도 WAKE_MS 뒤에는 저절로 풀린다.
//  · 화면을 보며 멈추면 곧 끝난다. 화면이 꺼진 채 멈추면(잠금화면·이어폰 단추) 잠금만 풀고
//    알림은 30분 남겨 둔다 — 안드로이드 12+ 는 화면 뒤에서 서비스를 새로 켜지 못하게 해서,
//    끝내 버리면 잠금화면에서 다시 ▶ 했을 때 지킴 없이 재생되어 또 끊긴다.
//  · 앱을 최근 목록에서 쓸어 없애면 함께 끝난다.
//
// 조절 — 알림 단추·잠금화면 플레이어·이어폰(유선·블루투스) 단추가 모두 같은 길로 온다.
//  · 미디어 세션(MediaSession)을 열어 두어 안드로이드가 이 앱을 '지금 음악 트는 앱'으로
//    알게 한다. 이어폰 단추와 잠금화면 플레이어는 이 세션에 말을 건다.
//    이어폰 한 번 = ⏯ · 두 번 = ⏭ (안드로이드 기본 규칙). 세 번 = ⏮ 는 안드로이드 13+ 에서만
//    — 12 이하는 시스템이 세 번 누름을 따로 알아보지 않는다. 블루투스 이어폰의 ⏮·⏭ 단추는 어디서나 된다.
//  · 어느 길로 오든 소리를 직접 건드리지 않고 웹에 알린다(BgPlayPlugin → js/bg-play.js).
//    소리를 내는 <audio> 와 재생 목록이 웹에 있기 때문이다.
//  · ⏮ 는 이전 곡이 있는 화면(매일찬양·매일기도)에서만 보인다 — 웹이 canPrev 로 알려 준다.
// ============================================================================

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

public class BgPlayService extends Service {

    private static final String CHANNEL_ID = "bg-play";
    private static final int NOTI_ID = 7301;
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_CAN_PREV = "canPrev";
    private static final String ACTION_TOGGLE = "com.jonathan.biblemem.bgplay.TOGGLE";
    private static final String ACTION_NEXT   = "com.jonathan.biblemem.bgplay.NEXT";
    private static final String ACTION_PREV   = "com.jonathan.biblemem.bgplay.PREV";
    /** 곡이 바뀔 때마다 새로 잰다. 한 곡이 이보다 길 일은 없다. */
    private static final long WAKE_MS = 2 * 60 * 60 * 1000L;

    /** 조절이 들어오면 불린다 — "toggle" · "play" · "pause" · "next" · "prev" */
    interface ActionListener { void onAction(String action); }
    static volatile ActionListener listener;

    /** 돌고 있는 서비스. 곡 이름만 바꿀 때는 서비스를 다시 부르지 않고 이것에 바로 알린다. */
    private static volatile BgPlayService instance;

    private PowerManager.WakeLock wakeLock;
    private boolean destroyed;   // holdWake·releaseWake 와 같은 자물쇠 아래에서만 읽고 쓴다
    private MediaSessionCompat session;
    private volatile String lastTitle;
    private volatile boolean canPrev;

    /**
     * 켠다 — 이미 돌고 있으면 알림의 곡 이름만 바꾼다.
     * 안드로이드 12+ 는 앱이 화면 뒤에 있을 때 포그라운드 서비스를 새로 켜는 것을 막으므로,
     * 곡이 넘어갈 때(화면이 꺼져 있을 때)는 새로 켜지 않고 돌고 있는 것을 갱신해야 한다.
     */
    static void start(Context ctx, String title, boolean canPrev) {
        BgPlayService s = instance;
        if (s != null) { s.canPrev = canPrev; s.holdWake(); s.refresh(title, false); return; }
        Intent i = new Intent(ctx, BgPlayService.class)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_CAN_PREV, canPrev);
        ContextCompat.startForegroundService(ctx, i);
    }

    /** 멈췄다 — 단추를 바로 ▶ 로 바꾼다(곧 다시 들을 수 있으니 CPU 잠금은 그대로) */
    static void showPaused() {
        BgPlayService s = instance;
        if (s != null) s.refresh(null, true);
    }

    /** 오래 멈춰 있다 — 서비스와 알림은 남기고 CPU 잠금만 푼다(다시 ▶ 하면 start 가 되잡는다) */
    static void idle() {
        BgPlayService s = instance;
        if (s == null) return;
        s.releaseWake();
        s.refresh(null, true);
    }

    static void stop(Context ctx) {
        // onDestroy 는 나중에 돈다 — 그 사이 start 가 오면 죽어 가는 서비스를 갱신하고 끝나 버리므로
        // 먼저 비워서, 바로 이은 start 는 새로 켜게 한다
        instance = null;
        ctx.stopService(new Intent(ctx, BgPlayService.class));
    }

    private static void dispatch(String action) {
        ActionListener l = listener;
        if (l != null) l.onAction(action);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        session = new MediaSessionCompat(this, "biblemem-praise");
        session.setCallback(new MediaSessionCompat.Callback() {
            // 이어폰 한 번 누름은 지금 상태(재생·멈춤)를 보고 안드로이드가 둘 중 하나를 부른다
            @Override public void onPlay()            { dispatch("play"); }
            @Override public void onPause()           { dispatch("pause"); }
            @Override public void onStop()            { dispatch("pause"); }
            @Override public void onSkipToNext()      { dispatch("next"); }
            @Override public void onSkipToPrevious()  { dispatch("prev"); }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_TOGGLE.equals(action) || ACTION_NEXT.equals(action) || ACTION_PREV.equals(action)) {
            dispatch(ACTION_TOGGLE.equals(action) ? "toggle" : ACTION_NEXT.equals(action) ? "next" : "prev");
            // 서비스가 이미 끝난 뒤 남은 단추가 눌려 새로 깨어난 경우 — 알림 없이 바로 접는다
            if (instance != this) stopSelf(startId);
            return START_NOT_STICKY;
        }
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        canPrev = intent != null && intent.getBooleanExtra(EXTRA_CAN_PREV, false);
        ensureChannel();
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        try {
            updateSession(title, false);
            ServiceCompat.startForeground(this, NOTI_ID, build(title, false), type);
        } catch (Exception e) {
            // 켜지는 사이 앱이 화면 뒤로 갔거나 권한이 막힌 경우 — 앱 전체가 죽지 않게 조용히 접는다
            stopSelf();
            return START_NOT_STICKY;
        }
        session.setActive(true);
        lastTitle = title;
        holdWake();
        instance = this;
        // 시스템이 앱을 정리했다가 이 서비스만 되살리면 소리 없는 알림만 남는다 — 되살리지 않는다
        return START_NOT_STICKY;
    }

    @SuppressLint("MissingPermission")   // 알림 권한이 없으면 안 보일 뿐, 서비스는 그대로 돈다
    private void refresh(String title, boolean paused) {
        if (title != null) lastTitle = title;
        updateSession(lastTitle, paused);
        synchronized (this) {
            if (destroyed) return;   // 끝난 뒤에 알림을 다시 띄우지 않는다
            try { NotificationManagerCompat.from(this).notify(NOTI_ID, build(lastTitle, paused)); }
            catch (SecurityException ignored) { /* 알림 권한 없음 — 곡 이름만 안 바뀐다 */ }
        }
    }

    /** 잠금화면 플레이어가 보는 곡 이름·상태, 이어폰 단추가 따르는 재생/멈춤 */
    private synchronized void updateSession(String title, boolean paused) {
        MediaSessionCompat s = session;
        if (s == null || destroyed) return;   // 닫힌 세션을 건드리면 예외가 난다
        s.setMetadata(new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, displayTitle(title))
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, getString(R.string.app_name))
                .build());
        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_STOP
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | (canPrev ? PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS : 0);
        s.setPlaybackState(new PlaybackStateCompat.Builder()
                .setActions(actions)
                // 재생 위치는 웹의 <audio> 가 알고 있어 여기서는 모른다고 둔다(잠금화면에 진행 막대가 없다)
                .setState(paused ? PlaybackStateCompat.STATE_PAUSED : PlaybackStateCompat.STATE_PLAYING,
                        PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, paused ? 0f : 1f)
                .build());
    }

    // 플러그인 호출은 Capacitor 의 일꾼 스레드에서, onStartCommand·onDestroy 는 메인 스레드에서 온다
    private synchronized void holdWake() {
        if (destroyed) return;
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "biblemem:bg-play");
            wakeLock.setReferenceCounted(false);
        }
        wakeLock.acquire(WAKE_MS);   // 다시 부르면 시간이 새로 잡힌다
    }

    private synchronized void releaseWake() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "찬양 이어 듣기", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("화면이 꺼져도 찬양이 이어지는 동안 보이는 알림");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private static String displayTitle(String title) {
        return title == null || title.isEmpty() ? "찬양을 듣는 중" : title;
    }

    private Notification build(String title, boolean paused) {
        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID);
        if (canPrev) b.addAction(R.drawable.ic_noti_prev, "이전 곡", control(ACTION_PREV, 3));
        b.addAction(paused ? R.drawable.ic_noti_play : R.drawable.ic_noti_pause,
                paused ? "재생" : "일시정지", control(ACTION_TOGGLE, 1));
        b.addAction(R.drawable.ic_noti_next, "다음 곡", control(ACTION_NEXT, 2));
        // 접힌 알림·잠금화면에서도 단추가 다 보이게. 세션을 붙여야 안드로이드 13+ 의 미디어 플레이어로 뜬다
        androidx.media.app.NotificationCompat.MediaStyle style = new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(session.getSessionToken());
        if (canPrev) style.setShowActionsInCompactView(0, 1, 2);
        else style.setShowActionsInCompactView(0, 1);
        return b.setStyle(style)
                .setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(displayTitle(title))
                .setContentText(paused ? "일시정지 · 눌러서 앱으로" : "화면이 꺼져도 이어집니다 · 눌러서 앱으로")
                .setContentIntent(pi)
                .setOngoing(true)
                .setSilent(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build();
    }

    private PendingIntent control(String action, int requestCode) {
        Intent i = new Intent(this, BgPlayService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, i,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** 최근 앱 목록에서 쓸어 없애면 — 소리도 이미 사라졌으니 알림도 거둔다 */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        synchronized (this) {
            destroyed = true;
            // 세션을 닫아야 이어폰 단추가 더는 이 앱으로 오지 않는다
            session.setActive(false);
            session.release();
        }
        releaseWake();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
