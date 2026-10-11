package com.rumoria.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.util.Log;

import com.yausername.youtubedl_android.YoutubeDL;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Rumoria's server inside the phone: the same Node server as the desktop app,
 * started by nodejs-mobile in this process, listening only on 127.0.0.1 and
 * guarded by a secret made for this launch (the page gets it as a cookie).
 * yt-dlp is youtubedl-android's (Python), with its QuickJS for YouTube's
 * challenges; it's brought up to date every few hours, like on the desktop.
 */
public final class NodeRunner {
    static { System.loadLibrary("node"); System.loadLibrary("native-lib"); }

    private static final String TAG = "Rumoria";
    public static final int WANTED_PORT = 27315;
    private static final long UPDATE_EVERY_MS = 6L * 60 * 60 * 1000;

    private static native int startNode(String[] args, String[] env);

    private static boolean started = false;
    private static volatile int port = 0;
    private static volatile String failure = null;
    private static volatile String step = "Preparando Rumoria…";
    private static final String token = newToken();
    private static final Object lock = new Object();

    private NodeRunner() {}

    public static String token() { return token; }
    /** The server's port once it's listening, or 0. */
    public static int port() { return port; }
    /** Why the server couldn't start, or null. */
    public static String failure() { return failure; }
    /** What's being done right now (for the first screen). */
    public static String step() { return step; }

    private static String newToken() {
        byte[] b = new byte[32];
        new SecureRandom().nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }

    public static synchronized void start(Context context) {
        if (started) return;
        started = true;
        final Context app = context.getApplicationContext();
        Thread t = new Thread(() -> run(app), "rumoria-node");
        t.setDaemon(true);
        t.start();
    }

    private static void run(Context app) {
        try {
            File nodeDir = new File(app.getFilesDir(), "nodejs-project");
            step = "Preparando Rumoria…";
            unpackIfNew(app, nodeDir);
            step = "Preparando el buscador de canciones…";
            YoutubeDL.getInstance().init(app);
            File portFile = new File(app.getCacheDir(), "server-port");
            //noinspection ResultOfMethodCallIgnored
            portFile.delete();
            String[] env = environment(app, nodeDir, portFile);
            watchPort(portFile);
            step = "Arrancando…";
            new Thread(() -> updateYtDlp(app, false), "rumoria-ytdlp").start();
            int code = startNode(new String[] { "node", "-r", new File(nodeDir, "shim.js").getAbsolutePath(), new File(nodeDir, "server/main.js").getAbsolutePath() }, env);
            failure = "El servidor de Rumoria se cerró (" + code + ").";
            Log.e(TAG, failure);
        } catch (Throwable e) {
            failure = "No se pudo arrancar Rumoria: " + e.getMessage();
            Log.e(TAG, "start", e);
        }
    }

    /** What Node and yt-dlp need: where things are, and this launch's secret. */
    private static String[] environment(Context app, File nodeDir, File portFile) throws Exception {
        File base = new File(app.getNoBackupFilesDir(), YoutubeDL.baseName);
        File python = new File(base, "packages/python");
        String libDir = app.getApplicationInfo().nativeLibraryDir;
        File ytDlp = new File(base, YoutubeDL.ytdlpDirName + "/" + YoutubeDL.ytdlpBin);
        File data = new File(app.getFilesDir(), "data");
        File cache = new File(app.getCacheDir(), "yt-dlp");
        //noinspection ResultOfMethodCallIgnored
        data.mkdirs();
        //noinspection ResultOfMethodCallIgnored
        cache.mkdirs();

        JSONObject ytEnv = new JSONObject();
        ytEnv.put("LD_LIBRARY_PATH", python.getAbsolutePath() + "/usr/lib");
        ytEnv.put("SSL_CERT_FILE", python.getAbsolutePath() + "/usr/etc/tls/cert.pem");
        ytEnv.put("PYTHONHOME", python.getAbsolutePath() + "/usr");
        ytEnv.put("HOME", python.getAbsolutePath() + "/usr");
        ytEnv.put("TMPDIR", app.getCacheDir().getAbsolutePath());
        ytEnv.put("PATH", System.getenv("PATH") + ":" + libDir);

        List<String> env = new ArrayList<>();
        env.add("RUMORIA_TOKEN=" + token);
        env.add("RUMORIA_DATA_DIR=" + data.getAbsolutePath());
        env.add("RUMORIA_STATIC=" + new File(nodeDir, "dist").getAbsolutePath());
        env.add("RUMORIA_PORT=" + WANTED_PORT);
        env.add("RUMORIA_PORT_FILE=" + portFile.getAbsolutePath());
        env.add("RUMORIA_YTDLP=" + new File(libDir, "libpython.so").getAbsolutePath());
        env.add("RUMORIA_YTDLP_PREFIX=" + new JSONArray().put(ytDlp.getAbsolutePath()));
        env.add("RUMORIA_YTDLP_ENV=" + ytEnv);
        env.add("RUMORIA_JS_RUNTIMES=quickjs:" + new File(libDir, "libqjs.so").getAbsolutePath());
        env.add("RUMORIA_YTDLP_CACHE=" + cache.getAbsolutePath());
        env.add("TMPDIR=" + app.getCacheDir().getAbsolutePath());
        env.add("HOME=" + app.getFilesDir().getAbsolutePath());
        return env.toArray(new String[0]);
    }

    /** The server writes its port to a file once it listens. */
    private static void watchPort(File portFile) {
        Thread t = new Thread(() -> {
            for (int i = 0; i < 1200 && port == 0 && failure == null; i++) {
                try {
                    if (portFile.isFile()) {
                        String s = new String(Files.readAllBytes(portFile.toPath()), StandardCharsets.US_ASCII).trim();
                        if (s.matches("\\d{2,5}")) {
                            port = Integer.parseInt(s);
                            synchronized (lock) { lock.notifyAll(); }
                            return;
                        }
                    }
                    Thread.sleep(100);
                } catch (Exception ignored) { /* next time */ }
            }
            if (port == 0 && failure == null) failure = "El servidor de Rumoria no respondió.";
            synchronized (lock) { lock.notifyAll(); }
        }, "rumoria-port");
        t.setDaemon(true);
        t.start();
    }

    /** Waits until the server listens (or failed); returns the port, or 0. */
    public static int awaitPort(long timeoutMs) {
        long end = System.currentTimeMillis() + timeoutMs;
        synchronized (lock) {
            while (port == 0 && failure == null && System.currentTimeMillis() < end) {
                try { lock.wait(250); } catch (InterruptedException e) { return port; }
            }
        }
        return port;
    }

    /**
     * The server and the page (one zip in the app) are unpacked again only
     * when the app was installed or updated since the last time.
     */
    private static void unpackIfNew(Context app, File nodeDir) throws Exception {
        PackageInfo info = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
        String stamp = info.lastUpdateTime + ":" + info.versionName;
        SharedPreferences prefs = app.getSharedPreferences("rumoria", Context.MODE_PRIVATE);
        if (stamp.equals(prefs.getString("unpacked", null)) && new File(nodeDir, "server/main.js").isFile()) return;
        deleteTree(nodeDir);
        File tmp = new File(app.getFilesDir(), "nodejs-project.tmp");
        deleteTree(tmp);
        String root = tmp.getCanonicalPath() + File.separator;
        try (InputStream in = app.getAssets().open("nodejs-project.zip"); ZipInputStream zip = new ZipInputStream(in)) {
            byte[] buf = new byte[64 * 1024];
            ZipEntry e;
            while ((e = zip.getNextEntry()) != null) {
                File out = new File(tmp, e.getName());
                // Never outside the folder (a zip entry with "../").
                if (!out.getCanonicalPath().startsWith(root)) throw new IOException("Entrada no válida: " + e.getName());
                if (e.isDirectory()) { //noinspection ResultOfMethodCallIgnored
                    out.mkdirs(); continue; }
                //noinspection ResultOfMethodCallIgnored
                out.getParentFile().mkdirs();
                try (OutputStream o = new FileOutputStream(out)) {
                    int n;
                    while ((n = zip.read(buf)) > 0) o.write(buf, 0, n);
                }
            }
        }
        if (!tmp.renameTo(nodeDir)) throw new IOException("No se pudo preparar la carpeta del servidor.");
        prefs.edit().putString("unpacked", stamp).apply();
    }

    private static void deleteTree(File f) {
        if (!f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /**
     * yt-dlp up to date: when YouTube changes something, a new yt-dlp usually
     * fixes it within days. At most every 6 hours (or now, when asked).
     */
    public static void updateYtDlp(Context app, boolean now) {
        SharedPreferences prefs = app.getSharedPreferences("rumoria", Context.MODE_PRIVATE);
        long last = prefs.getLong("ytdlpChecked", 0);
        if (!now && System.currentTimeMillis() - last < UPDATE_EVERY_MS) return;
        try {
            YoutubeDL.UpdateStatus s = YoutubeDL.getInstance().updateYoutubeDL(app, YoutubeDL.UpdateChannel._STABLE);
            prefs.edit().putLong("ytdlpChecked", System.currentTimeMillis()).apply();
            Log.i(TAG, "yt-dlp: " + s + " " + YoutubeDL.getInstance().versionName(app));
        } catch (Exception e) {
            Log.w(TAG, "yt-dlp update", e);
        }
    }
}
