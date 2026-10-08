package com.jonathan.biblemem;

// ============================================================================
// AlarmReceiver — 찬양 알람 시각이 되었을 때(앱 안에서만 받는다)
// ============================================================================
// 매일 알람이면 다음 날 것을 다시 걸고, 날짜 알람이면 목록에서 지운 뒤 울린다(AlarmService).
// 다른 앱이 이 신호를 흉내 내 알람을 울리지 못하게 밖으로 열지 않는다 — 재부팅은 AlarmBootReceiver 가 받는다.
// ============================================================================

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

public class AlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (PraiseAlarm.ACTION_FIRE.equals(action)) {
            JSONObject a = PraiseAlarm.find(ctx, intent.getIntExtra(PraiseAlarm.EXTRA_ID, -1));
            if (a == null) return;   // 그사이 지운 알람
            AlarmService.reserve(a.optJSONArray("files"));   // 목록에서 빼기 전에 곡을 붙잡는다 — 정리에 지워지지 않게
            if (a.optBoolean("daily")) PraiseAlarm.schedule(ctx, a);
            else PraiseAlarm.remove(ctx, a.optInt("id"));
            AlarmService.ring(ctx, a);
        }
    }
}
