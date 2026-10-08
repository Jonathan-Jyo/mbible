package com.jonathan.biblemem;

// ============================================================================
// AlarmBootReceiver — 휴대폰을 다시 켜거나 앱을 새로 깔면 찬양 알람을 다시 건다
// ============================================================================
// 안드로이드는 다시 켜면 걸어 둔 알람을 잊는다. 시스템이 보내는 신호를 받아야 해서 밖으로 열어 두지만,
// 하는 일은 「남은 알람 다시 걸기」뿐이다 — 알람을 울리는 신호는 안에서만 받는 AlarmReceiver 가 맡는다.
// ============================================================================

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AlarmBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            PraiseAlarm.rescheduleAll(ctx);
        }
    }
}
