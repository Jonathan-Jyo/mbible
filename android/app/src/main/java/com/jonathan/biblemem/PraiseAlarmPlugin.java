package com.jonathan.biblemem;

// ============================================================================
// PraiseAlarm (플러그인) — 웹(매일찬양 알람 설정)이 찬양 알람을 거는 문
// ============================================================================
//   files()                        알람 폴더에 이미 있는 곡 파일 이름 { names }
//   writeBegin({ name })           곡 하나를 받기 시작 → { handle }
//   writeChunk({ handle, data })   조각(base64)을 이어 쓴다 — 큰 곡도 메모리에 통째로 올리지 않는다
//   writeEnd({ handle })           다 받았다(그때 비로소 제 이름으로 바뀐다)
//   writeAbort({ handle })         그만둔다(받던 조각을 버린다)
//   setAll({ alarms })             알람 목록을 통째로 바꿔 건다(PraiseAlarm.replaceAll)
//   status()                       { exact: 정확한 알람이 되는가, notify: 알림이 보이는가 }
//   stop()                         울리고 있으면 멈춘다
// ============================================================================

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(name = "PraiseAlarm")
public class PraiseAlarmPlugin extends Plugin {

    private static final class Upload {
        final File part, done;
        final FileOutputStream out;
        Upload(File part, File done, FileOutputStream out) { this.part = part; this.done = done; this.out = out; }
    }

    private final Map<Integer, Upload> uploads = new ConcurrentHashMap<>();
    private final AtomicInteger nextHandle = new AtomicInteger(1);

    @PluginMethod
    public void files(PluginCall call) {
        JSArray names = new JSArray();
        File[] all = PraiseAlarm.dir(getContext()).listFiles();
        if (all != null) for (File f : all) if (!f.getName().endsWith(".part") && f.length() > 0) names.put(f.getName());
        call.resolve(new JSObject().put("names", names));
    }

    @PluginMethod
    public void writeBegin(PluginCall call) {
        String name = call.getString("name");
        if (!PraiseAlarm.safeName(name)) { call.reject("쓸 수 없는 이름입니다"); return; }
        File dir = PraiseAlarm.dir(getContext());
        File part = new File(dir, name + ".part"), done = new File(dir, name);
        try {
            int h = nextHandle.getAndIncrement();
            uploads.put(h, new Upload(part, done, new FileOutputStream(part, false)));
            call.resolve(new JSObject().put("handle", h));
        } catch (Exception e) {
            call.reject("알람 곡을 쓰지 못했습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        Upload u = uploads.get(call.getData().optInt("handle", -1));
        if (u == null) { call.reject("받는 중인 곡이 없습니다"); return; }
        try {
            u.out.write(android.util.Base64.decode(call.getString("data", ""), android.util.Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            abort(call.getData().optInt("handle", -1));
            call.reject("알람 곡을 쓰지 못했습니다(저장 공간이 모자랄 수 있습니다): " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeEnd(PluginCall call) {
        int h = call.getData().optInt("handle", -1);
        Upload u = uploads.remove(h);
        if (u == null) { call.reject("받는 중인 곡이 없습니다"); return; }
        try {
            u.out.close();
            if (u.done.exists() && !u.done.delete()) throw new java.io.IOException("옛 파일을 지우지 못했습니다");
            if (!u.part.renameTo(u.done)) throw new java.io.IOException("이름을 바꾸지 못했습니다");
            call.resolve();
        } catch (Exception e) {
            if (!u.part.delete()) android.util.Log.w("PraiseAlarm", "받다 만 조각을 지우지 못했습니다");
            call.reject("알람 곡을 마무리하지 못했습니다: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeAbort(PluginCall call) {
        abort(call.getData().optInt("handle", -1));
        call.resolve();
    }

    private void abort(int h) {
        Upload u = uploads.remove(h);
        if (u == null) return;
        try { u.out.close(); } catch (Exception ignored) { /* 닫기 실패는 할 일이 없다 */ }
        if (!u.part.delete()) android.util.Log.w("PraiseAlarm", "받다 만 조각을 지우지 못했습니다");
    }

    @PluginMethod
    public void setAll(PluginCall call) {
        JSONArray alarms = call.getData().optJSONArray("alarms");
        PraiseAlarm.replaceAll(getContext(), alarms == null ? new JSONArray() : alarms);
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(new JSObject()
                .put("exact", PraiseAlarm.canExact(getContext()))
                .put("notify", NotificationManagerCompat.from(getContext()).areNotificationsEnabled()));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        AlarmService.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (Integer h : new ArrayList<>(uploads.keySet())) abort(h);
    }
}
