package com.rumoria.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.MutableContextWrapper;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.util.Collections;

/**
 * The player: Rumoria's page in a WebView that lives as long as the app's
 * process, not as long as its window. The window shows it while it's open;
 * without a window (closed from the recent apps, or started from Android Auto
 * with the phone in a pocket) the page goes on playing, and the notification,
 * the lock screen, the headphones and the car keep driving it.
 * One channel to the page, open only to it (RumoriaAndroid): what's playing,
 * the buttons pressed elsewhere, back, links to open outside.
 */
final class WebHost {
    private static final String TAG = "Rumoria";
    private static WebHost host;

    /** What the window does with the page's wishes (theme colour, going to the background). */
    interface Window {
        void onTheme(boolean dark, String bg);
        void onExit();
        void onShown();
    }

    private final Context app;
    private final MutableContextWrapper context;
    private WebView web;
    private JavaScriptReplyProxy proxy;
    private String origin;
    private boolean loaded = false;
    private Window window;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final java.util.List<String> pending = new java.util.ArrayList<>();

    private WebHost(Context app) {
        this.app = app.getApplicationContext();
        this.context = new MutableContextWrapper(this.app);
        create();
        new Thread(() -> {
            int port = NodeRunner.awaitPort(180_000);
            if (port > 0) ui.post(() -> open(port));
        }, "rumoria-host").start();
    }

    /** The one player of this process (made on first use, on the main thread). */
    static WebHost get(Context c) {
        if (host == null) host = new WebHost(c);
        return host;
    }

    static WebHost peek() { return host; }

    WebView view() { return web; }
    boolean isLoaded() { return loaded; }

    @SuppressLint("SetJavaScriptEnabled")
    private void create() {
        web = new WebView(context);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // The next song starts by itself (and the alarm clock, and the car), without a tap.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled((app.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.setWebViewClient(new WebViewClient() {
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
                    loaded = true;
                    if (window != null) window.onShown();
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The page's process died (memory): a fresh page instead of a crash.
                Log.w(TAG, "WebView renderer gone");
                recover();
                return true;
            }
        });
    }

    private void open(int port) {
        origin = "http://127.0.0.1:" + port;
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "RumoriaAndroid", Collections.singleton(origin), (view, message, source, isMainFrame, reply) -> {
                if (!isMainFrame) return;
                boolean first = proxy == null;
                proxy = reply;
                if (first) { flush(); Updater.tellPage(); }
                onMessage(message.getData());
            });
        }
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setCookie(origin, "rum_t=" + NodeRunner.token() + "; Path=/; HttpOnly; SameSite=Strict", ok -> web.loadUrl(origin + "/"));
    }

    private void recover() {
        ViewGroup parent = (ViewGroup) web.getParent();
        if (parent != null) parent.removeView(web);
        try { web.destroy(); } catch (Exception ignored) { /* already gone */ }
        proxy = null;
        loaded = false;
        synchronized (pending) { pending.clear(); }
        create();
        if (parent != null) parent.addView(web, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (origin != null) open(Integer.parseInt(origin.substring(origin.lastIndexOf(':') + 1)));
    }

    /** The window shows the page (its own context while it's there: dialogs, menus). */
    void attach(android.app.Activity a, ViewGroup into, Window w) {
        ViewGroup parent = (ViewGroup) web.getParent();
        if (parent != null) parent.removeView(web);
        context.setBaseContext(a);
        window = w;
        into.addView(web, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (loaded) w.onShown();
    }

    /** The window closed: the page stays, playing, with the app's context. */
    void detach(Window w) {
        if (window != w) return;
        window = null;
        ViewGroup parent = (ViewGroup) web.getParent();
        if (parent != null) parent.removeView(web);
        context.setBaseContext(app);
    }

    /** A message from the page (JSON). */
    private void onMessage(String data) {
        if (data == null || data.length() > 20_000) return;
        try {
            JSONObject m = new JSONObject(data);
            switch (m.optString("t")) {
                case "state": PlaybackService.update(app, m); break;
                case "theme": if (window != null) window.onTheme(m.optBoolean("dark", true), m.optString("bg")); break;
                case "exit": if (window != null) window.onExit(); break;
                case "open": openOutside(Uri.parse(m.optString("url"))); break;
                case "ytdlp": new Thread(() -> NodeRunner.updateYtDlp(app, true)).start(); break;
                case "update": { MainActivity a = MainActivity.current(); if (a != null) Updater.checkNow(a); break; }
                case "install": { MainActivity a = MainActivity.current(); if (a != null) Updater.installReady(a); break; }
                default: break;
            }
        } catch (Exception e) {
            Log.w(TAG, "message", e);
        }
    }

    /**
     * To the page (JSON). While it's still loading (the car asked for a song as Rumoria started),
     * it waits and goes as soon as the page is listening. False if it had to wait.
     */
    boolean send(JSONObject m) {
        if (proxy == null) {
            synchronized (pending) { if (pending.size() < 20) pending.add(m.toString()); }
            return false;
        }
        ui.post(() -> { if (proxy != null) proxy.postMessage(m.toString()); });
        return true;
    }

    private void flush() {
        java.util.List<String> out;
        synchronized (pending) { out = new java.util.ArrayList<>(pending); pending.clear(); }
        for (String m : out) proxy.postMessage(m);
    }

    /** A button of the notification, the lock screen, the headphones or the car. */
    void command(String action, long posMs) {
        try { send(new JSONObject().put("t", "cmd").put("a", action).put("pos", posMs / 1000.0)); } catch (Exception ignored) { /* never */ }
    }

    /** Back: the page closes what's open or goes back; with nothing left it says "exit". */
    boolean back() {
        if (proxy == null) return false;
        try { return send(new JSONObject().put("t", "back")); } catch (Exception e) { return false; }
    }

    private void openOutside(Uri u) {
        if (u == null || !"https".equals(u.getScheme())) return;
        try { app.startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { /* no browser */ }
    }
}
