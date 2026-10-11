package com.rumoria.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Context;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaControllerCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.AfterClass;
import org.junit.BeforeClass;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * What Android Auto does, done by a test: connect to Rumoria's media service
 * with no window open, browse Favoritas and the lists, play a song of a list,
 * pause it, and play what a voice search finds. Needs the network (YouTube).
 */
@RunWith(AndroidJUnit4.class)
public class AutoTest {
    private static MediaBrowserCompat browser;
    private static MediaControllerCompat controller;
    private static String listId;

    @BeforeClass
    public static void connect() throws Exception {
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        NodeRunner.start(c);
        assertTrue("the server starts", NodeRunner.awaitPort(120_000) > 0);
        // A list of ours to find in the car.
        JSONObject made = call("POST", "/api/lists", new JSONObject().put("name", "Para el coche")
            .put("tracks", new JSONArray().put(new JSONObject().put("title", "Never Gonna Give You Up").put("artist", "Rick Astley").put("yt", "dQw4w9WgXcQ"))));
        listId = made.getString("id");
        CountDownLatch ok = new CountDownLatch(1);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            browser = new MediaBrowserCompat(c, new ComponentName(c, PlaybackService.class), new MediaBrowserCompat.ConnectionCallback() {
                @Override public void onConnected() {
                    controller = new MediaControllerCompat(c, browser.getSessionToken());
                    ok.countDown();
                }
            }, null);
            browser.connect();
        });
        assertTrue("connects like Android Auto", ok.await(30, TimeUnit.SECONDS));
    }

    @AfterClass
    public static void clean() throws Exception {
        if (controller != null) controller.getTransportControls().pause();
        if (listId != null) call("DELETE", "/api/lists/" + listId, null);
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> { if (browser != null) browser.disconnect(); });
    }

    private static List<MediaBrowserCompat.MediaItem> children(String parent) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<List<MediaBrowserCompat.MediaItem>> got = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> browser.subscribe(parent, new MediaBrowserCompat.SubscriptionCallback() {
            @Override public void onChildrenLoaded(String id, List<MediaBrowserCompat.MediaItem> items) { got.set(items); done.countDown(); }
        }));
        assertTrue("children of " + parent, done.await(30, TimeUnit.SECONDS));
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> browser.unsubscribe(parent));
        return got.get();
    }

    private static List<String> ids(List<MediaBrowserCompat.MediaItem> items) {
        List<String> out = new ArrayList<>();
        for (MediaBrowserCompat.MediaItem i : items) out.add(i.getMediaId());
        return out;
    }

    /** Waits until the session says it's playing (or paused) a song whose title has `title`. */
    private static void awaitState(int state, String title, long ms) throws Exception {
        long end = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < end) {
            PlaybackStateCompat s = controller.getPlaybackState();
            MediaMetadataCompat m = controller.getMetadata();
            String t = m == null ? "" : String.valueOf(m.getString(MediaMetadataCompat.METADATA_KEY_TITLE));
            if (s != null && s.getState() == state && t.toLowerCase().contains(title.toLowerCase())) return;
            Thread.sleep(500);
        }
        throw new AssertionError("not " + state + " with «" + title + "»: " + controller.getPlaybackState() + " " + (controller.getMetadata() == null ? null : controller.getMetadata().getString(MediaMetadataCompat.METADATA_KEY_TITLE)));
    }

    @Test
    public void browsesFavoritasAndLists() throws Exception {
        assertEquals(List.of("liked", "lists"), ids(children(AutoLibrary.ROOT)));
        List<String> lists = ids(children("lists"));
        assertTrue("our list is there: " + lists, lists.contains("list:" + listId));
        List<MediaBrowserCompat.MediaItem> songs = children("list:" + listId);
        assertEquals(1, songs.size());
        assertEquals("list:" + listId + ":0", songs.get(0).getMediaId());
        assertTrue(songs.get(0).isPlayable());
        assertEquals("Never Gonna Give You Up", String.valueOf(songs.get(0).getDescription().getTitle()));
        assertNotNull(children("liked"));
    }

    @Test
    public void playsAListPausesAndPlaysASearch() throws Exception {
        controller.getTransportControls().playFromMediaId("list:" + listId + ":0", null);
        awaitState(PlaybackStateCompat.STATE_PLAYING, "Never Gonna", 90_000);
        controller.getTransportControls().pause();
        awaitState(PlaybackStateCompat.STATE_PAUSED, "Never Gonna", 15_000);
        controller.getTransportControls().playFromSearch("despacito luis fonsi", null);
        awaitState(PlaybackStateCompat.STATE_PLAYING, "Despacito", 90_000);
    }

    /** A call to Rumoria's server in this phone, with this launch's secret. */
    private static JSONObject call(String method, String path, JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + NodeRunner.port() + path).openConnection();
        c.setRequestMethod(method);
        c.setRequestProperty("X-Rumoria-Token", NodeRunner.token());
        c.setRequestProperty("X-Rumoria", "1");
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = c.getOutputStream()) { o.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
        }
        try (InputStream in = c.getResponseCode() < 400 ? c.getInputStream() : c.getErrorStream(); ByteArrayOutputStream o = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while (in != null && (n = in.read(buf)) > 0) o.write(buf, 0, n);
            String s = o.toString("UTF-8");
            return s.startsWith("{") ? new JSONObject(s) : new JSONObject();
        }
    }
}
