package com.rumoria.app;

import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat.MediaItem;
import android.support.v4.media.MediaDescriptionCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * What the car (Android Auto) shows: two tabs, Favoritas and Tus listas, and
 * each list's songs. Read from Rumoria's own server inside the phone (with
 * this launch's secret). Ids: "liked", "lists", "list:<id>", and to play:
 * "liked:<n>", "list:<id>:<n>".
 */
final class AutoLibrary {
    static final String ROOT = "root";
    private static final Pattern LIST_ID = Pattern.compile("^[a-f0-9]{16}$");
    // Android Auto's own hints: lists as a grid, songs as a list.
    private static final String STYLE_BROWSABLE = "android.media.browse.CONTENT_STYLE_BROWSABLE_HINT";
    private static final String STYLE_PLAYABLE = "android.media.browse.CONTENT_STYLE_PLAYABLE_HINT";
    private static final int STYLE_LIST = 1;
    private static final int STYLE_GRID = 2;
    private static final int MAX = 200;

    private AutoLibrary() {}

    /** The hints for the root (what the car's head unit reads). */
    static Bundle rootExtras() {
        Bundle b = new Bundle();
        b.putBoolean("android.media.browse.SEARCH_SUPPORTED", true);
        b.putInt(STYLE_BROWSABLE, STYLE_GRID);
        b.putInt(STYLE_PLAYABLE, STYLE_LIST);
        return b;
    }

    /** A request to play, from a media id → the page's command, or null. */
    static JSONObject playCommand(String mediaId) throws Exception {
        if (mediaId == null) return null;
        String[] p = mediaId.split(":");
        if (p.length == 2 && p[0].equals("liked") && p[1].matches("\\d{1,5}")) {
            return new JSONObject().put("t", "cmd").put("a", "playFrom").put("kind", "liked").put("index", Integer.parseInt(p[1]));
        }
        if (p.length == 3 && p[0].equals("list") && LIST_ID.matcher(p[1]).matches() && p[2].matches("\\d{1,5}")) {
            return new JSONObject().put("t", "cmd").put("a", "playFrom").put("kind", "list").put("id", p[1]).put("index", Integer.parseInt(p[2]));
        }
        return null;
    }

    /** The children of a node; empty if it's unknown or the server isn't up. */
    static List<MediaItem> children(String parent) throws Exception {
        List<MediaItem> out = new ArrayList<>();
        if (ROOT.equals(parent)) {
            out.add(folder("liked", "Favoritas", "Tus canciones con estrella"));
            out.add(folder("lists", "Tus listas", null));
            return out;
        }
        if ("liked".equals(parent)) {
            JSONArray songs = get("/api/likes").optJSONArray("songs");
            for (int i = 0; songs != null && i < Math.min(songs.length(), MAX); i++) {
                JSONObject s = songs.getJSONObject(i);
                out.add(song("liked:" + i, s.optString("title"), s.optString("artist")));
            }
            return out;
        }
        if ("lists".equals(parent)) {
            JSONArray lists = get("/api/lists").optJSONArray("lists");
            for (int i = 0; lists != null && i < Math.min(lists.length(), MAX); i++) {
                JSONObject l = lists.getJSONObject(i);
                String id = l.optString("id");
                if (!LIST_ID.matcher(id).matches() || l.optInt("count") <= 0) continue;
                String folder = l.optString("folder", "");
                out.add(folder("list:" + id, l.optString("name"), l.optInt("count") + " canciones" + (folder.isEmpty() || "null".equals(folder) ? "" : " · " + folder)));
            }
            return out;
        }
        if (parent != null && parent.startsWith("list:")) {
            String id = parent.substring(5);
            if (!LIST_ID.matcher(id).matches()) return out;
            JSONArray tracks = get("/api/lists/" + URLEncoder.encode(id, "UTF-8")).optJSONArray("tracks");
            for (int i = 0; tracks != null && i < Math.min(tracks.length(), MAX); i++) {
                JSONObject t = tracks.getJSONObject(i);
                out.add(song("list:" + id + ":" + i, t.optString("title"), t.optString("artist")));
            }
        }
        return out;
    }

    private static MediaItem folder(String id, String title, String sub) {
        MediaDescriptionCompat.Builder d = new MediaDescriptionCompat.Builder().setMediaId(id).setTitle(title);
        if (sub != null) d.setSubtitle(sub);
        return new MediaItem(d.build(), MediaItem.FLAG_BROWSABLE);
    }

    private static MediaItem song(String id, String title, String artist) {
        return new MediaItem(new MediaDescriptionCompat.Builder().setMediaId(id).setTitle(title).setSubtitle(artist).build(), MediaItem.FLAG_PLAYABLE);
    }

    /** GET from Rumoria's server in this phone (127.0.0.1, with the secret). */
    private static JSONObject get(String path) throws Exception {
        int port = NodeRunner.awaitPort(20_000);
        if (port == 0) return new JSONObject();
        HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        c.setConnectTimeout(5000);
        c.setReadTimeout(15_000);
        c.setInstanceFollowRedirects(false);
        c.setRequestProperty("X-Rumoria-Token", NodeRunner.token());
        c.setRequestProperty("Accept", "application/json");
        if (c.getResponseCode() != 200) return new JSONObject();
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream o = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) { o.write(buf, 0, n); if (o.size() > 8_000_000) break; }
            return new JSONObject(o.toString("UTF-8"));
        }
    }
}
