package com.rumoria.app;

import android.app.Application;

/** Starts Rumoria's server as soon as the app's process starts (once per process). */
public class RumoriaApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        NodeRunner.start(this);
    }
}
