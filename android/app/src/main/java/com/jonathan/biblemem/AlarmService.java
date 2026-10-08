package com.jonathan.biblemem;

// ============================================================================
// AlarmService — 찬양 알람이 울린다(안드로이드가 직접 튼다)
// ============================================================================
// 앱이 꺼져 있어도, 화면이 잠겨 있어도 울려야 하므로 웹 화면을 거치지 않는다.
// 알람을 걸 때 앱 전용 폴더(files/alarm/)에 복사해 둔 곡을 MediaPlayer 로 차례로, 끝나면 처음부터 튼다.
//
//  · 알람 소리 통로(USAGE_ALARM)로 낸다 — 미디어 소리를 0 으로 해 두어도 알람 소리 크기로 울린다
//  · 알림에 「끄기」·「10분 뒤 다시」. 알림을 누르면 알람을 멈추고 앱으로 들어가 매일찬양이 이어 튼다
//  · RING_LIMIT 동안 아무도 끄지 않으면 스스로 멈춘다
//  · 곡 파일이 없거나 하나도 열리지 않으면 기기의 기본 알람 소리로 대신 울린다 — 알람은 울려야 한다
// ============================================================================

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class AlarmService extends Service {

    private static final String CHANNEL_ID = "praise-alarm";
    private static final int NOTI_ID = 7302;
    private static final String ACTION_RING = "com.jonathan.biblemem.alarm.RING";
    private static final String ACTION_STOP = "com.jonathan.biblemem.alarm.STOP";
    private static final String ACTION_SNOOZE = "com.jonathan.biblemem.alarm.SNOOZE";
    private static final String EXTRA_ALARM = "alarm";
    /** 알림을 눌러 앱으로 들어갈 때 열 화면(예: "pray.html?autoplay=pray") — MainActivity 가 읽는다 */
    static final String EXTRA_OPEN = "alarmOpen";
    private static final long RING_LIMIT_MS = 30 * 60 * 1000L;

    private static volatile AlarmService instance;
    private static volatile Set<String> inUse = Collections.emptySet();

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = this::finish;
    private MediaPlayer player;
    private List<File> songs = new ArrayList<>();
    private int idx, failsInRow;
    private boolean usingFallback, finished;
    private Ringtone lastResort;
    private JSONObject alarm;
    private AudioManager audio;
    private AudioFocusRequest focusReq;

    /** 지금 울리는 알람이 쓰는 곡 파일 이름 — 정리할 때 지우지 않게 */
    static Set<String> inUse() { return inUse; }

    /** 알람이 막 울리려 할 때 — 서비스가 뜨기 전에 곡 파일이 정리되지 않게 먼저 붙잡아 둔다 */
    static void reserve(JSONArray files) {
        Set<String> s = new HashSet<>(inUse);
        if (files != null) for (int i = 0; i < files.length(); i++) s.add(files.optString(i));
        inUse = s;
    }

    static boolean isRinging() { return instance != null; }

    static void ring(Context c, JSONObject alarm) {
        Intent i = new Intent(c, AlarmService.class).setAction(ACTION_RING).putExtra(EXTRA_ALARM, alarm.toString());
        try { ContextCompat.startForegroundService(c, i); }
        catch (Exception e) { android.util.Log.e("AlarmService", "알람을 울리지 못했습니다", e); }
    }

    /** 울리고 있으면 멈춘다(앱을 열었을 때 등) */
    static void stop() {
        AlarmService s = instance;
        if (s != null) s.main.post(s::finish);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) { finish(); return START_NOT_STICKY; }
        if (ACTION_SNOOZE.equals(action)) { snooze(); return START_NOT_STICKY; }
        if (!ACTION_RING.equals(action)) { stopSelf(startId); return START_NOT_STICKY; }

        try { alarm = new JSONObject(intent.getStringExtra(EXTRA_ALARM)); }
        catch (Exception e) { stopSelf(startId); return START_NOT_STICKY; }
        ensureChannel();
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        try {
            ServiceCompat.startForeground(this, NOTI_ID, build(), type);
        } catch (Exception e) {
            android.util.Log.e("AlarmService", "알람을 앞으로 띄우지 못했습니다", e);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        instance = this;
        releasePlayer();
        songs = existingSongs(alarm.optJSONArray("files"));
        Set<String> names = new HashSet<>();
        for (File f : songs) names.add(f.getName());
        inUse = names;
        idx = 0; failsInRow = 0; usingFallback = songs.isEmpty(); finished = false;
        requestFocus();
        playCurrent();
        main.removeCallbacks(autoStop);
        main.postDelayed(autoStop, RING_LIMIT_MS);
        return START_NOT_STICKY;
    }

    private List<File> existingSongs(JSONArray names) {
        List<File> out = new ArrayList<>();
        if (names == null) return out;
        File dir = PraiseAlarm.dir(this);
        for (int i = 0; i < names.length(); i++) {
            String n = names.optString(i);
            if (!PraiseAlarm.safeName(n)) continue;
            File f = new File(dir, n);
            if (f.isFile() && f.length() > 0) out.add(f);
        }
        return out;
    }

    private void playCurrent() {
        releasePlayer();
        MediaPlayer mp = new MediaPlayer();
        mp.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build());
        mp.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
        try {
            if (usingFallback) {
                Uri tone = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
                if (tone == null) tone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                mp.setDataSource(this, tone);
                mp.setLooping(true);
            } else {
                mp.setDataSource(songs.get(idx).getAbsolutePath());
                mp.setOnCompletionListener(m -> next());
            }
            mp.setOnErrorListener((m, what, extra) -> { onSongFailed(); return true; });
            mp.prepare();
            mp.start();
            player = mp;
            failsInRow = 0;
        } catch (Exception e) {
            android.util.Log.w("AlarmService", "알람 곡을 열지 못했습니다", e);
            mp.release();
            onSongFailed();
        }
    }

    private void next() {
        if (finished || songs.isEmpty()) return;   // 끈 뒤에 남은 「다음 곡」 예약이 돌지 않게
        idx = (idx + 1) % songs.size();
        playCurrent();
    }

    /** 곡 하나가 안 열리면 다음 곡으로. 한 바퀴 내내 안 열리면 기본 알람 소리로 */
    private void onSongFailed() {
        if (finished) return;
        if (usingFallback) { playLastResort(); return; }
        if (++failsInRow >= songs.size()) { usingFallback = true; playCurrent(); return; }
        main.post(this::next);
    }

    private void requestFocus() {
        audio = getSystemService(AudioManager.class);
        if (audio == null) return;
        AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).build();
            audio.requestAudioFocus(focusReq);
        } else {
            audio.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        }
    }

    private void abandonFocus() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusReq != null) audio.abandonAudioFocusRequest(focusReq);
        else audio.abandonAudioFocus(null);
    }

    private void snooze() {
        if (alarm != null) {
            try {
                JSONObject s = new JSONObject(alarm.toString());
                s.put("from", alarm.optInt("from", alarm.optInt("id")));   // 어느 알람에서 왔나 — 매일 알람이면 그것을 끌 때 함께 거둔다
                s.put("fromDaily", alarm.optBoolean("daily", alarm.optBoolean("fromDaily")));
                s.put("id", PraiseAlarm.SNOOZE_ID);
                s.put("daily", false);
                s.put("at", System.currentTimeMillis() + PraiseAlarm.SNOOZE_MS);
                PraiseAlarm.put(this, s);
                PraiseAlarm.schedule(this, s);
            } catch (Exception e) {
                android.util.Log.e("AlarmService", "10분 뒤 알람을 걸지 못했습니다", e);
            }
        }
        finish();
    }

    /** 기본 알람 소리마저 MediaPlayer 로 못 열면(외부 저장소의 소리 파일 등) 시스템 소리 재생기로 —
     *  안드로이드가 알아서 시스템 기본 소리로 물러선다. 그것도 안 되면 할 수 있는 것이 없다 */
    private void playLastResort() {
        releasePlayer();
        try {
            Uri tone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            lastResort = RingtoneManager.getRingtone(this, tone);
            if (lastResort == null) { finish(); return; }
            lastResort.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) lastResort.setLooping(true);
            lastResort.play();
        } catch (Exception e) {
            android.util.Log.e("AlarmService", "알람 소리를 하나도 내지 못했습니다", e);
            finish();
        }
    }

    private void finish() {
        finished = true;
        main.removeCallbacks(autoStop);
        if (lastResort != null) { lastResort.stop(); lastResort = null; }
        releasePlayer();
        abandonFocus();
        inUse = Collections.emptySet();
        if (instance == this) instance = null;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void releasePlayer() {
        if (player == null) return;
        try { player.stop(); } catch (Exception ignored) { /* 이미 멈췄다 */ }
        player.release();
        player = null;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "찬양 알람", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("정한 시각에 찬양이 울리는 알람");
        ch.setSound(null, null);   // 소리는 찬양이 낸다 — 알림음까지 겹치지 않게
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private PendingIntent self(String action, int code) {
        return PendingIntent.getService(this, code, new Intent(this, AlarmService.class).setAction(action),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification build() {
        // 열 화면 — 알람이 정해 왔으면 그대로, 5.22.0 에 건 알람(open 없음)은 매일찬양에서 이어 틀기
        String page = alarm.optString("open", "");
        if (page.isEmpty()) {
            String autoplay = alarm.optString("autoplay", "");
            page = "praise.html?autoplay=" + Uri.encode(autoplay.isEmpty() ? "1" : autoplay);
        }
        Intent open = new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_OPEN, page);
        PendingIntent openPi = PendingIntent.getActivity(this, 1, open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String title = alarm.optString("title", "찬양 알람");
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(title.isEmpty() ? "찬양 알람" : title)
                .setContentText(alarm.optString("body", "눌러서 앱에서 이어 듣기"))
                .setContentIntent(openPi)
                .addAction(R.drawable.ic_noti_pause, "끄기", self(ACTION_STOP, 2))
                .addAction(R.drawable.ic_noti_next, "10분 뒤 다시", self(ACTION_SNOOZE, 3))
                .setOngoing(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build();
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(autoStop);
        releasePlayer();
        abandonFocus();
        inUse = Collections.emptySet();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
