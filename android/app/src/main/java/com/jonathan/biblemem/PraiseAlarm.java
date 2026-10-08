package com.jonathan.biblemem;

// ============================================================================
// PraiseAlarm — 찬양 알람을 기억하고 안드로이드 알람 시계로 건다
// ============================================================================
// 예전 알람은 그 시각에 알림만 띄웠다 — 소리는 앱 안의 웹 화면이 내는데, 앱이 꺼져 있거나
// 화면이 잠겨 있으면 그 화면이 없어 낼 수가 없었다. 그래서 알람에 쓸 곡을 미리 앱 전용 폴더
// (files/alarm/)에 복사해 두고(웹이 PraiseAlarmPlugin 으로 조각조각 넘긴다), 그 시각에는
// 안드로이드가 직접 튼다(AlarmService).
//
//  · 알람 시계 기능(setAlarmClock)으로 건다 — 절전(도즈) 중에도 제시각에 울리고, 울릴 때
//    포그라운드 서비스를 켤 수 있다(안드로이드 12+ 의 예외). 정확한 알람 권한이 없으면 덜 정확한 길로.
//  · 매일 알람은 울릴 때 다음 날 것을 다시 건다. 날짜 알람은 울리면 지운다.
//  · 휴대폰을 다시 켜거나 앱을 새로 깔면 다시 건다(AlarmReceiver).
//
// 알람 하나(JSON): { id, title, body, daily, hour, minute, at(밀리초, 날짜 알람), files:[이름], autoplay }
//   autoplay — 알림을 눌러 앱으로 들어갈 때 매일찬양이 이어 틀 것("ch:채널" 또는 "1"=오늘 예약)
// ============================================================================

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;

final class PraiseAlarm {

    private PraiseAlarm() {}

    private static final String PREF = "praise_alarm";
    private static final String K_LIST = "alarms";
    static final String ACTION_FIRE = "com.jonathan.biblemem.alarm.FIRE";
    static final String EXTRA_ID = "alarmId";
    /** 「10분 뒤 다시」로 건 알람의 번호 — 하나만 둔다 */
    static final int SNOOZE_ID = 999999;
    static final long SNOOZE_MS = 10 * 60 * 1000L;

    /** 알람 곡을 두는 앱 전용 폴더 */
    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "alarm");
        if (!d.exists() && !d.mkdirs()) android.util.Log.w("PraiseAlarm", "알람 폴더를 만들지 못했습니다");
        return d;
    }

    /** 파일 이름으로 쓸 수 있는가 — 폴더 밖으로 나가는 이름(../ 등)을 막는다 */
    static boolean safeName(String n) {
        return n != null && n.matches("[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}");
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    static synchronized JSONArray load(Context c) {
        try { return new JSONArray(prefs(c).getString(K_LIST, "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }

    private static synchronized void save(Context c, JSONArray a) {
        prefs(c).edit().putString(K_LIST, a.toString()).apply();
    }

    static synchronized JSONObject find(Context c, int id) {
        JSONArray a = load(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && o.optInt("id") == id) return o;
        }
        return null;
    }

    /** 같은 번호가 있으면 바꾸고 없으면 더한다 */
    static synchronized void put(Context c, JSONObject alarm) {
        JSONArray a = load(c), out = new JSONArray();
        int id = alarm.optInt("id");
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && o.optInt("id") != id) out.put(o);
        }
        out.put(alarm);
        save(c, out);
    }

    static synchronized void remove(Context c, int id) {
        JSONArray a = load(c), out = new JSONArray();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && o.optInt("id") != id) out.put(o);
        }
        save(c, out);
    }

    /** 이 알람이 다음에 울릴 시각(밀리초). 이미 지난 날짜 알람이면 0 */
    static long nextAt(JSONObject a) {
        if (!a.optBoolean("daily")) return a.optLong("at", 0);
        Calendar t = Calendar.getInstance();
        t.set(Calendar.HOUR_OF_DAY, a.optInt("hour", 6));
        t.set(Calendar.MINUTE, a.optInt("minute", 0));
        t.set(Calendar.SECOND, 0);
        t.set(Calendar.MILLISECOND, 0);
        if (t.getTimeInMillis() <= System.currentTimeMillis()) t.add(Calendar.DAY_OF_MONTH, 1);
        return t.getTimeInMillis();
    }

    static boolean canExact(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = c.getSystemService(AlarmManager.class);
        return am != null && am.canScheduleExactAlarms();
    }

    private static PendingIntent fireIntent(Context c, int id, int flags) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE).putExtra(EXTRA_ID, id);
        return PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_IMMUTABLE | flags);
    }

    static void schedule(Context c, JSONObject a) {
        long at = nextAt(a);
        if (at <= System.currentTimeMillis()) return;
        AlarmManager am = c.getSystemService(AlarmManager.class);
        if (am == null) return;
        PendingIntent fire = fireIntent(c, a.optInt("id"), PendingIntent.FLAG_UPDATE_CURRENT);
        if (canExact(c)) {
            // 상태 표시줄의 ⏰ 를 누르면 앱이 열린다
            PendingIntent show = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class),
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), fire);
        } else {
            // 정확한 알람 권한이 없다 — 절전 중에도 울리기는 하지만 몇 분 늦을 수 있다
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, fire);
        }
    }

    static void cancel(Context c, int id) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = fireIntent(c, id, PendingIntent.FLAG_NO_CREATE);
        if (am != null && pi != null) { am.cancel(pi); pi.cancel(); }
    }

    /** 웹이 정한 알람 목록으로 통째로 바꾼다.
     *  「10분 뒤 다시」는 — 매일 알람에서 나왔으면 그 알람이 새 목록에도 있을 때만 남긴다(설정에서 껐는데
     *  다시 울리면 안 된다). 날짜 알람에서 나왔으면 늘 남긴다 — 날짜 알람은 울린 뒤 목록에서 빠지므로,
     *  다시 알림을 누르고 앱을 열기만 해도 지워져 버리기 때문이다(길어야 10분이다) */
    static synchronized void replaceAll(Context c, JSONArray incoming) {
        Set<Integer> stillOn = new HashSet<>();
        for (int i = 0; i < incoming.length(); i++) {
            JSONObject o = incoming.optJSONObject(i);
            if (o != null) stillOn.add(o.optInt("id"));
        }
        JSONArray old = load(c), keep = new JSONArray();
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o == null) continue;
            if (o.optInt("id") == SNOOZE_ID && (!o.optBoolean("fromDaily") || stillOn.contains(o.optInt("from")))) {
                keep.put(o);
                continue;
            }
            cancel(c, o.optInt("id"));
        }
        for (int i = 0; i < incoming.length(); i++) {
            JSONObject o = incoming.optJSONObject(i);
            if (o == null || o.optInt("id") == SNOOZE_ID) continue;
            keep.put(o);
            schedule(c, o);
        }
        save(c, keep);
        cleanFiles(c);
    }

    /** 휴대폰을 다시 켰을 때 등 — 남은 알람을 모두 다시 건다. 지난 날짜 알람은 버린다 */
    static synchronized void rescheduleAll(Context c) {
        JSONArray a = load(c), keep = new JSONArray();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            if (!o.optBoolean("daily") && o.optLong("at", 0) <= System.currentTimeMillis()) continue;
            keep.put(o);
            schedule(c, o);
        }
        save(c, keep);
        cleanFiles(c);
    }

    /** 어느 알람도 쓰지 않는 곡 파일을 지운다(지금 울리는 곡은 남긴다) */
    static synchronized void cleanFiles(Context c) {
        Set<String> used = new HashSet<>(AlarmService.inUse());
        JSONArray a = load(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            JSONArray f = o == null ? null : o.optJSONArray("files");
            if (f == null) continue;
            for (int j = 0; j < f.length(); j++) used.add(f.optString(j));
        }
        File[] all = dir(c).listFiles();
        if (all == null) return;
        for (File f : all) {
            if (used.contains(f.getName())) continue;
            // 막 받은 곡은 남긴다 — 웹이 곡을 다 옮긴 뒤 알람 목록을 넘기기 전에, 다른 정리(시간대 바뀜 등)가
            // 끼어들어 지워 버리지 않게. 받다 만 조각(.part)은 더 오래 둔다
            long age = System.currentTimeMillis() - f.lastModified();
            if (age < (f.getName().endsWith(".part") ? 60 : 10) * 60 * 1000L) continue;
            if (!f.delete()) android.util.Log.w("PraiseAlarm", "쓰지 않는 알람 곡을 지우지 못했습니다: " + f.getName());
        }
    }
}
