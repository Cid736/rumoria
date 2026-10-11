package com.rumoria.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.util.Collections;

/**
 * The window: Rumoria's page (served by its own server, inside the phone) in
 * a WebView. The page and the app talk through one channel, open only to
 * that page: what's playing (for the notification and the lock screen), the
 * buttons pressed there, the back button, and links to open in the browser.
 */
public class MainActivity extends Activity {
    private static final String TAG = "Rumoria";
    private static MainActivity current;

    private FrameLayout root;
    private WebView web;
    private TextView splash;
    private JavaScriptReplyProxy proxy;
    private String origin;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean dark = true;

    /** The window that's open, if any (the notification's buttons go to its page). */
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

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setVisibility(View.INVISIBLE);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        splash = new TextView(this);
        splash.setTextColor(Color.parseColor("#B8B4C4"));
        splash.setTextSize(16);
        splash.setGravity(Gravity.CENTER);
        splash.setPadding(48, 48, 48, 48);
        splash.setText(NodeRunner.step());
        root.addView(splash, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        applyBars();
        configure(web);
        tickSplash();

        new Thread(() -> {
            int port = NodeRunner.awaitPort(180_000);
            ui.post(() -> { if (port > 0) open(port); else splash.setText(NodeRunner.failure() != null ? NodeRunner.failure() : "Rumoria no arrancó. Ciérrala y vuelve a abrirla."); });
        }, "rumoria-wait").start();

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }
        Updater.checkSoon(this);
    }

    private void tickSplash() {
        if (splash.getVisibility() != View.VISIBLE) return;
        if (NodeRunner.port() == 0 && NodeRunner.failure() == null) splash.setText(NodeRunner.step());
        ui.postDelayed(this::tickSplash, 300);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configure(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // The next song starts by itself (and the alarm clock), without a tap.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);

        w.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (origin != null && origin.equals(u.getScheme() + "://" + u.getAuthority())) return false;
                openOutside(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (origin != null && url.startsWith(origin)) {
                    web.setVisibility(View.VISIBLE);
                    splash.setVisibility(View.GONE);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The page's process died (memory): a fresh window instead of a crash.
                Log.w(TAG, "WebView renderer gone");
                recreate();
                return true;
            }
        });
    }

    private void open(int port) {
        origin = "http://127.0.0.1:" + port;
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "RumoriaAndroid", Collections.singleton(origin), (view, message, source, isMainFrame, reply) -> {
                if (!isMainFrame) return;
                proxy = reply;
                onMessage(message.getData());
            });
        }
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setCookie(origin, "rum_t=" + NodeRunner.token() + "; Path=/; HttpOnly; SameSite=Strict", ok -> web.loadUrl(origin + "/"));
    }

    /** A message from the page (JSON). */
    private void onMessage(String data) {
        if (data == null || data.length() > 20_000) return;
        try {
            JSONObject m = new JSONObject(data);
            switch (m.optString("t")) {
                case "state": PlaybackService.update(this, m); break;
                case "theme": dark = m.optBoolean("dark", true); setRootColor(m.optString("bg")); applyBars(); break;
                case "exit": moveTaskToBack(true); break;
                case "open": openOutside(Uri.parse(m.optString("url"))); break;
                case "ytdlp": new Thread(() -> NodeRunner.updateYtDlp(getApplicationContext(), true)).start(); break;
                case "update": Updater.checkNow(this); break;
                default: break;
            }
        } catch (Exception e) {
            Log.w(TAG, "message", e);
        }
    }

    private void setRootColor(String hex) {
        if (hex != null && hex.matches("#[0-9a-fA-F]{6}")) root.setBackgroundColor(Color.parseColor(hex));
    }

    /** Light or dark icons in the status and navigation bars, to match the page. */
    private void applyBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(!dark);
        c.setAppearanceLightNavigationBars(!dark);
    }

    /** To the page (JSON). */
    void send(JSONObject m) {
        ui.post(() -> { if (proxy != null) proxy.postMessage(m.toString()); });
    }

    /** A button in the notification or on the lock screen. */
    void command(String action, long posMs) {
        try { send(new JSONObject().put("t", "cmd").put("a", action).put("pos", posMs / 1000.0)); } catch (Exception ignored) { /* never */ }
    }

    private void back() {
        // The page goes back (or closes what's open); when it can't, it says "exit".
        if (proxy == null) { moveTaskToBack(true); return; }
        try { send(new JSONObject().put("t", "back")); } catch (Exception ignored) { /* never */ }
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

    private void openOutside(Uri u) {
        if (u == null || !"https".equals(u.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) { /* no browser */ }
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        // Closing the window stops the music (the page plays it).
        PlaybackService.stop(this);
        web.destroy();
        super.onDestroy();
    }
}
