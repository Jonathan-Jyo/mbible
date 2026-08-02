package com.jonathan.biblemem;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 폴더 통째 읽기(SAF) — super.onCreate 앞에서 등록해야 한다
        registerPlugin(HymnTreePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
