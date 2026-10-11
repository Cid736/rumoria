package com.rumoria.app;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * The window: it shows the player (WebHost, Rumoria's page) while it's open,
 * keeps it clear of the system bars and the keyboard, matches the bars to the
 * page's theme and passes the back button on. Closing it doesn't stop the
 * music: the page lives on with the app (see WebHost).
 */
public class MainActivity extends Activity implements WebHost.Window {
    private static MainActivity current;

    private FrameLayout root;
    private TextView splash;
    private WebHost host;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean dark = true;

    /** The window that's open, if any. */
    static MainActivity current() { return current; }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        current = this;
        NodeRunner.start(this);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0B0A10"));
        // The page stays clear of the status bar, the navigation bar, the notch and the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets i = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        splash = new TextView(this);
        splash.setTextColor(Color.parseColor("#B8B4C4"));
        splash.setTextSize(16);
        splash.setGravity(Gravity.CENTER);
        splash.setPadding(48, 48, 48, 48);
        splash.setText(NodeRunner.step());
        root.addView(splash, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        applyBars();

        host = WebHost.get(this);
        host.view().setVisibility(host.isLoaded() ? View.VISIBLE : View.INVISIBLE);
        host.attach(this, root, this);
        tickSplash();

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
        Updater.checkSoon(this);
    }

    private void tickSplash() {
        if (splash.getVisibility() != View.VISIBLE) return;
        if (NodeRunner.failure() != null) { splash.setText(NodeRunner.failure()); return; }
        if (NodeRunner.port() == 0) splash.setText(NodeRunner.step());
        ui.postDelayed(this::tickSplash, 300);
    }

    @Override
    public void onShown() {
        host.view().setVisibility(View.VISIBLE);
        splash.setVisibility(View.GONE);
    }

    @Override
    public void onTheme(boolean isDark, String bg) {
        dark = isDark;
        if (bg != null && bg.matches("#[0-9a-fA-F]{6}")) root.setBackgroundColor(Color.parseColor(bg));
        applyBars();
    }

    @Override
    public void onExit() { moveTaskToBack(true); }

    /** Light or dark icons in the status and navigation bars, to match the page. */
    private void applyBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(!dark);
        c.setAppearanceLightNavigationBars(!dark);
    }

    private void back() {
        // The page goes back (or closes what's open); when it can't, it says "exit".
        if (!host.back()) moveTaskToBack(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        Updater.resume(this);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        back();
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        // The window goes; the page (and the music) stays with the app.
        host.detach(this);
        super.onDestroy();
    }
}
