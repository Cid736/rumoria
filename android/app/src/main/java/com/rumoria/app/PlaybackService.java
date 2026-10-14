package com.rumoria.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.Process;
import android.support.v4.media.MediaBrowserCompat.MediaItem;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Keeps the music going with the screen off, in another app or in the car:
 * a media notification (cover, title, previous / pause / next, the position),
 * the lock screen's controls, the headphones' and the car's buttons, and
 * Android Auto (Favoritas and your lists, and "play … on Rumoria"). It's fed
 * by what the page says is playing; its buttons go back to the page (WebHost),
 * which plays the music. Headphones or Bluetooth going away pause it.
 */
public class PlaybackService extends MediaBrowserServiceCompat {
    private static final String TAG = "Rumoria";
    private static final String CHANNEL = "playback";
    private static final int ID = 1;
    // Covers only from YouTube's image servers.
    private static final Pattern SAFE_IMG = Pattern.compile("^https://i\\d?\\.ytimg\\.com/[\\w\\-/.]+(\\?[\\w\\-=&%.]*)?$");
    // Who may browse your library: this app, Android Auto, Android Automotive's media app, the Google
    // app / Assistant (voice), and the system (its media controls). Checked against the caller's uid.
    private static final Set<String> BROWSERS = new HashSet<>(Arrays.asList(
        "com.rumoria.app", "com.google.android.projection.gearhead", "com.google.android.carassistant",
        "com.android.car.media", "com.google.android.googlequicksearchbox", "com.android.systemui"));

    private static PlaybackService running;
    private static JSONObject last;

    private MediaSessionCompat session;
    private PowerManager.WakeLock wake;
    private final ExecutorService images = Executors.newSingleThreadExecutor();
    private final ExecutorService library = Executors.newSingleThreadExecutor();
    private String artUrl;
    private Bitmap art;
    private boolean foreground = false;
    private boolean noisyOn = false;

    // Headphones unplugged or Bluetooth gone: pause, before the phone's speaker takes over.
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(i.getAction())) send("pause", 0);
        }
    };

    /** What's playing, from the page: { title, artist, art, playing, pos, dur }. */
    static void update(Context c, JSONObject state) {
        last = state;
        if (running != null && (running.foreground || !state.optBoolean("playing"))) { running.show(state); return; }
        if (!state.optBoolean("playing") || state.optString("title").isEmpty()) { if (running != null) running.show(state); return; }
        // Playing: the service started (and in the foreground) so Android keeps it going.
        try {
            ContextCompat.startForegroundService(c, new Intent(c, PlaybackService.class));
        } catch (Exception e) {
            Log.w(TAG, "playback service", e);
            if (running != null) running.show(state);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        // The player (the page) is there even when the car starts Rumoria with no window.
        NodeRunner.start(this);
        WebHost.get(this);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Reproducción", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Lo que suena, con sus botones");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        session = new MediaSessionCompat(this, "Rumoria");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { send("play", 0); }
            @Override public void onPause() { send("pause", 0); }
            @Override public void onSkipToNext() { send("next", 0); }
            @Override public void onSkipToPrevious() { send("prev", 0); }
            @Override public void onSeekTo(long pos) { send("seek", pos); }
            @Override public void onStop() {
                // v1.12.3: Android 13+ shows the music in the panel's media player; swiping it away (only
                // while paused) calls stop. From the system and paused: Rumoria's player closes too. Anyone
                // else's stop (the car, Bluetooth): just a pause, the queue stays.
                String who = null;
                try { androidx.media.MediaSessionManager.RemoteUserInfo u = session.getCurrentControllerInfo(); if (u != null) who = u.getPackageName(); } catch (Exception ignored) { /* unknown: a pause */ }
                if ("com.android.systemui".equals(who) && (last == null || !last.optBoolean("playing"))) { send("close", 0); closeNotification(); }
                else send("pause", 0);
            }
            // v1.12.3: aleatorio and repetir, from the system's controls (Android 13+: its two extra buttons), the car or Bluetooth.
            @Override public void onCustomAction(String action, Bundle extras) { if ("shuffle".equals(action) || "repeat".equals(action)) send(action, 0); }
            @Override public void onSetShuffleMode(int mode) {
                if ((mode != PlaybackStateCompat.SHUFFLE_MODE_NONE) != (last != null && last.optBoolean("shuffle"))) send("shuffle", 0);
            }
            @Override public void onSetRepeatMode(int mode) {
                // The page goes off → all → one: once or twice to get where asked.
                String want = mode == PlaybackStateCompat.REPEAT_MODE_ONE ? "one" : mode == PlaybackStateCompat.REPEAT_MODE_NONE ? "off" : "all";
                String now = last != null ? last.optString("repeat", "off") : "off";
                java.util.List<String> order = Arrays.asList("off", "all", "one");
                int steps = (order.indexOf(want) - Math.max(0, order.indexOf(now)) + 3) % 3;
                for (int i = 0; i < steps; i++) send("repeat", 0);
            }
            @Override public void onPlayFromMediaId(String mediaId, Bundle extras) {
                try { JSONObject m = AutoLibrary.playCommand(mediaId); if (m != null) toPage(m); } catch (Exception e) { Log.w(TAG, "play id", e); }
            }
            @Override public void onPlayFromSearch(String query, Bundle extras) {
                // "Play … on Rumoria" (empty: "play some music": what was on, or Favoritas).
                try { toPage(new JSONObject().put("t", "cmd").put("a", "playSearch").put("q", query == null ? "" : query.trim())); } catch (Exception e) { Log.w(TAG, "play search", e); }
            }
        });
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session.setPlaybackState(state(false, 0, false, "off"));
        session.setActive(true);
        setSessionToken(session.getSessionToken());
        wake = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Rumoria:playback");
        wake.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent != null ? intent.getAction() : null;
        if (a != null && (a.equals("prev") || a.equals("play") || a.equals("pause") || a.equals("next") || a.equals("shuffle") || a.equals("repeat"))) {
            send(a, 0);
            if (foreground || last == null) return START_NOT_STICKY;
        }
        // v1.12.3: the notification swiped away (only possible while paused): Rumoria's player closes too.
        if ("close".equals(a)) {
            send("close", 0);
            closeNotification();
            return START_NOT_STICKY;
        }
        // Android wants the notification at once.
        show(last != null ? last : new JSONObject());
        return START_NOT_STICKY;
    }

    // ---- Android Auto: what it can browse ----
    @Override
    public BrowserRoot onGetRoot(@NonNull String clientPackageName, int clientUid, Bundle rootHints) {
        return allowed(clientPackageName, clientUid) ? new BrowserRoot(AutoLibrary.ROOT, AutoLibrary.rootExtras()) : null;
    }

    private boolean allowed(String pkg, int uid) {
        if (uid == Process.myUid() || uid == Process.SYSTEM_UID) return true;
        if (!BROWSERS.contains(pkg)) return false;
        String[] pkgs = getPackageManager().getPackagesForUid(uid);
        return pkgs != null && Arrays.asList(pkgs).contains(pkg);
    }

    @Override
    public void onLoadChildren(@NonNull String parentId, @NonNull Result<List<MediaItem>> result) {
        result.detach();
        library.execute(() -> {
            try { result.sendResult(AutoLibrary.children(parentId)); } catch (Exception e) { Log.w(TAG, "browse", e); result.sendResult(new ArrayList<>()); }
        });
    }

    private void send(String action, long posMs) {
        WebHost h = WebHost.peek();
        if (h != null) h.command(action, posMs);
    }

    private void toPage(JSONObject m) {
        WebHost h = WebHost.peek();
        if (h != null) h.send(m);
    }

    /**
     * What the system's controls show. v1.12.3: aleatorio and repetir as its
     * two extra buttons (Android 13+ draws those from here, not from the
     * notification), each saying whether it's on.
     */
    private static PlaybackStateCompat state(boolean playing, long pos, boolean shuffle, String repeat) {
        return new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_PLAY_FROM_MEDIA_ID | PlaybackStateCompat.ACTION_PLAY_FROM_SEARCH
                | PlaybackStateCompat.ACTION_SET_SHUFFLE_MODE | PlaybackStateCompat.ACTION_SET_REPEAT_MODE)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, pos, playing ? 1f : 0f)
            .addCustomAction(new PlaybackStateCompat.CustomAction.Builder("shuffle",
                shuffle ? "Aleatorio: sí" : "Aleatorio: no", shuffle ? R.drawable.ic_shuffle : R.drawable.ic_shuffle_off).build())
            .addCustomAction(new PlaybackStateCompat.CustomAction.Builder("repeat", repeatLabel(repeat), repeatIcon(repeat)).build())
            .build();
    }

    private static String repeatLabel(String repeat) {
        return "one".equals(repeat) ? "Repetir: esta canción" : "all".equals(repeat) ? "Repetir: todo" : "Repetir: no";
    }

    private static int repeatIcon(String repeat) {
        return "one".equals(repeat) ? R.drawable.ic_repeat_one : "all".equals(repeat) ? R.drawable.ic_repeat : R.drawable.ic_repeat_off;
    }

    /** Nothing playing any more (closed): no notification, no foreground, the service may go. */
    private void closeNotification() {
        last = null;
        if (wake.isHeld()) wake.release();
        listenNoisy(false);
        session.setPlaybackState(new PlaybackStateCompat.Builder().setState(PlaybackStateCompat.STATE_STOPPED, 0, 0f).build());
        if (foreground) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        foreground = false;
        getSystemService(NotificationManager.class).cancel(ID);
        stopSelf();
    }

    private void show(JSONObject s) {
        boolean playing = s.optBoolean("playing");
        String title = s.optString("title", "Rumoria");
        String artist = s.optString("artist", "");
        long pos = Math.round(s.optDouble("pos", 0) * 1000);
        long dur = Math.round(s.optDouble("dur", 0) * 1000);
        String url = s.optString("art", "");
        boolean shuffle = s.optBoolean("shuffle");
        String repeat = s.optString("repeat", "off");
        // Closed in Rumoria (the page says nothing plays): the notification goes too. An empty
        // state (Android starting the service, which wants a notification at once) still shows one.
        if (s.has("title") && title.isEmpty()) { closeNotification(); return; }
        if (!url.equals(artUrl)) { artUrl = url; art = null; loadArt(url); }

        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, dur > 0 ? dur : -1);
        if (art != null) meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(meta.build());
        session.setPlaybackState(state(playing, pos, shuffle, repeat));
        session.setShuffleMode(shuffle ? PlaybackStateCompat.SHUFFLE_MODE_ALL : PlaybackStateCompat.SHUFFLE_MODE_NONE);
        session.setRepeatMode("one".equals(repeat) ? PlaybackStateCompat.REPEAT_MODE_ONE : "all".equals(repeat) ? PlaybackStateCompat.REPEAT_MODE_ALL : PlaybackStateCompat.REPEAT_MODE_NONE);
        listenNoisy(playing);

        PendingIntent content = session.getController().getSessionActivity();
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_rumoria)
            .setContentTitle(title)
            .setContentText(artist)
            .setLargeIcon(art)
            .setContentIntent(content)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(playing)
            // Swiped away (Android lets you only while paused): Rumoria's player closes too.
            .setDeleteIntent(action("close"))
            // Up to Android 12 the notification's own buttons (from 13, the system draws them from the session's state).
            .addAction(shuffle ? R.drawable.ic_shuffle : R.drawable.ic_shuffle_off, shuffle ? "Aleatorio: sí" : "Aleatorio: no", action("shuffle"))
            .addAction(R.drawable.ic_prev, "Anterior", action("prev"))
            .addAction(playing ? R.drawable.ic_pause : R.drawable.ic_play, playing ? "Pausa" : "Reproducir", action(playing ? "pause" : "play"))
            .addAction(R.drawable.ic_next, "Siguiente", action("next"))
            .addAction(repeatIcon(repeat), repeatLabel(repeat), action("repeat"))
            .setStyle(new MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(1, 2, 3));
        Notification n = b.build();
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;

        try {
            if (playing) {
                wake.acquire(6 * 60 * 60 * 1000L);
                ServiceCompat.startForeground(this, ID, n, type);
                foreground = true;
            } else {
                if (wake.isHeld()) wake.release();
                if (foreground) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
                foreground = false;
                getSystemService(NotificationManager.class).notify(ID, n);
            }
        } catch (Exception e) {
            // Android didn't allow the foreground right now (started from the background): the notification at least.
            Log.w(TAG, "foreground", e);
            getSystemService(NotificationManager.class).notify(ID, n);
        }
    }

    private void listenNoisy(boolean on) {
        if (on == noisyOn) return;
        noisyOn = on;
        if (on) ContextCompat.registerReceiver(this, noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED);
        else unregisterReceiver(noisy);
    }

    /** A notification button: back to this service, which hands it to the page. */
    private PendingIntent action(String what) {
        Intent i = new Intent(this, PlaybackService.class).setAction(what);
        return PendingIntent.getService(this, what.hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void loadArt(String url) {
        if (url.isEmpty() || !SAFE_IMG.matcher(url).matches()) return;
        images.execute(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setInstanceFollowRedirects(false);
                if (c.getResponseCode() != 200 || c.getContentLength() > 2_000_000) return;
                Bitmap bmp;
                try (InputStream in = c.getInputStream()) { bmp = BitmapFactory.decodeStream(in); }
                if (bmp == null) return;
                // Square, from the middle (YouTube's covers are 16:9 with bars).
                int side = Math.min(bmp.getWidth(), bmp.getHeight());
                Bitmap sq = Bitmap.createBitmap(bmp, (bmp.getWidth() - side) / 2, (bmp.getHeight() - side) / 2, side, side);
                new android.os.Handler(getMainLooper()).post(() -> {
                    if (!url.equals(artUrl)) return;
                    art = sq;
                    if (last != null) show(last);
                });
            } catch (Exception e) {
                Log.w(TAG, "cover", e);
            }
        });
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Swiped away from the recent apps: the music goes on if it's playing (the page lives on); paused, it all stops.
        if (!foreground) stopSelf();
    }

    @Override
    public void onDestroy() {
        running = null;
        listenNoisy(false);
        if (wake.isHeld()) wake.release();
        session.setActive(false);
        session.release();
        images.shutdownNow();
        library.shutdownNow();
        getSystemService(NotificationManager.class).cancel(ID);
        super.onDestroy();
    }
}
