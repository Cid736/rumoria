package com.rumoria.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Keeps the music going with the screen off or in another app: a media
 * notification (cover, title, previous / pause / next, the position) and the
 * lock screen's controls, fed by what the page says is playing. Its buttons
 * go back to the page, which plays the music.
 */
public class PlaybackService extends Service {
    private static final String TAG = "Rumoria";
    private static final String CHANNEL = "playback";
    private static final int ID = 1;
    // Covers only from YouTube's image servers.
    private static final Pattern SAFE_IMG = Pattern.compile("^https://i\\d?\\.ytimg\\.com/[\\w\\-/.]+(\\?[\\w\\-=&%.]*)?$");

    private static PlaybackService running;
    private static JSONObject last;

    private MediaSessionCompat session;
    private PowerManager.WakeLock wake;
    private final ExecutorService images = Executors.newSingleThreadExecutor();
    private String artUrl;
    private Bitmap art;
    private boolean foreground = false;

    /** What's playing, from the page: { title, artist, art, playing, pos, dur }. */
    static void update(Context c, JSONObject state) {
        last = state;
        if (running != null) { running.show(state); return; }
        if (!state.optBoolean("playing") || state.optString("title").isEmpty()) return;
        // Started while you're in the app (you pressed play): allowed in the foreground.
        Intent i = new Intent(c, PlaybackService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception e) {
            Log.w(TAG, "playback service", e);
        }
    }

    static void stop(Context c) {
        last = null;
        c.stopService(new Intent(c, PlaybackService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
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
            @Override public void onStop() { send("pause", 0); }
        });
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session.setActive(true);
        wake = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Rumoria:playback");
        wake.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String a = intent != null ? intent.getAction() : null;
        if (a != null && (a.equals("prev") || a.equals("play") || a.equals("pause") || a.equals("next"))) {
            send(a, 0);
            if (foreground || last == null) return START_NOT_STICKY;
        }
        // Android wants the notification at once.
        show(last != null ? last : new JSONObject());
        return START_NOT_STICKY;
    }

    private void send(String action, long posMs) {
        MainActivity a = MainActivity.current();
        if (a != null) a.command(action, posMs);
    }

    private void show(JSONObject s) {
        boolean playing = s.optBoolean("playing");
        String title = s.optString("title", "Rumoria");
        String artist = s.optString("artist", "");
        long pos = Math.round(s.optDouble("pos", 0) * 1000);
        long dur = Math.round(s.optDouble("dur", 0) * 1000);
        String url = s.optString("art", "");
        if (!url.equals(artUrl)) { artUrl = url; art = null; loadArt(url); }

        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, dur > 0 ? dur : -1);
        if (art != null) meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(meta.build());
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, pos, playing ? 1f : 0f)
            .build());

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
            .addAction(R.drawable.ic_prev, "Anterior", action("prev"))
            .addAction(playing ? R.drawable.ic_pause : R.drawable.ic_play, playing ? "Pausa" : "Reproducir", action(playing ? "pause" : "play"))
            .addAction(R.drawable.ic_next, "Siguiente", action("next"))
            .setStyle(new MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        Notification n = b.build();

        if (playing) {
            wake.acquire(6 * 60 * 60 * 1000L);
            int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
            ServiceCompat.startForeground(this, ID, n, type);
            foreground = true;
        } else {
            if (wake.isHeld()) wake.release();
            if (!foreground) {
                // Android asked for the notification already: shown once, then it can be swiped away.
                int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
                ServiceCompat.startForeground(this, ID, n, type);
            }
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
            foreground = false;
            getSystemService(NotificationManager.class).notify(ID, n);
        }
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
        // Swiped away from the recent apps: the window (and its music) is gone.
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = null;
        if (wake.isHeld()) wake.release();
        session.setActive(false);
        session.release();
        images.shutdownNow();
        getSystemService(NotificationManager.class).cancel(ID);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
