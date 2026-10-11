package com.rumoria.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * Updates, like the desktop app: the newest release on GitHub
 * (Cid736/rumoria). If it's newer, its APK for this phone's processor is
 * downloaded, checked against the SHA-256 GitHub publishes for it, and
 * Android asks you to install it (over this one: your lists stay).
 */
final class Updater {
    private static final String TAG = "Rumoria";
    private static final String LATEST = "https://api.github.com/repos/Cid736/rumoria/releases/latest";
    private static final long EVERY_MS = 12L * 60 * 60 * 1000;
    private static boolean busy = false;
    // A verified update waiting for the permission to install it (asked in Android's settings).
    private static String pendingTag = null;
    private static File pendingApk = null;

    private Updater() {}

    /** The APK for this phone's processor. */
    static String assetName() {
        String abi = Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "arm64-v8a";
        if (abi.startsWith("arm64")) return "Rumoria-Android.apk";
        if (abi.startsWith("armeabi")) return "Rumoria-Android-32bit.apk";
        if (abi.equals("x86_64")) return "Rumoria-Android-x86_64.apk";
        return "Rumoria-Android.apk";
    }

    /** "1.10.2" newer than "1.9.0"? */
    static boolean newer(String a, String b) {
        String[] x = a.replaceFirst("^v", "").split("\\.");
        String[] y = b.replaceFirst("^v", "").split("\\.");
        for (int i = 0; i < 3; i++) {
            int p = i < x.length && x[i].matches("\\d{1,5}") ? Integer.parseInt(x[i]) : 0;
            int q = i < y.length && y[i].matches("\\d{1,5}") ? Integer.parseInt(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    /** At most every 12 hours, a while after opening. */
    static void checkSoon(Activity a) {
        SharedPreferences prefs = a.getSharedPreferences("rumoria", Context.MODE_PRIVATE);
        if (System.currentTimeMillis() - prefs.getLong("updateChecked", 0) < EVERY_MS) return;
        new android.os.Handler(a.getMainLooper()).postDelayed(() -> check(a, false), 20_000);
    }

    static void checkNow(Activity a) { check(a, true); }

    private static synchronized void check(Activity a, boolean asked) {
        if (busy) return;
        busy = true;
        final Context app = a.getApplicationContext();
        new Thread(() -> {
            try {
                JSONObject rel = new JSONObject(new String(get(LATEST, 1_000_000), "UTF-8"));
                app.getSharedPreferences("rumoria", Context.MODE_PRIVATE).edit().putLong("updateChecked", System.currentTimeMillis()).apply();
                String tag = rel.optString("tag_name");
                String mine = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
                if (!newer(tag, mine)) { if (asked) toast(a, "Tienes la última versión (" + mine + ")."); return; }
                JSONArray assets = rel.optJSONArray("assets");
                JSONObject asset = null;
                for (int i = 0; assets != null && i < assets.length(); i++) {
                    if (assetName().equals(assets.getJSONObject(i).optString("name"))) asset = assets.getJSONObject(i);
                }
                String digest = asset == null ? "" : asset.optString("digest");
                if (asset == null || !digest.matches("(?i)sha256:[0-9a-f]{64}")) { if (asked) toast(a, "La versión " + tag + " aún no tiene APK para este móvil."); return; }
                String url = asset.optString("browser_download_url");
                if (!url.startsWith("https://github.com/Cid736/rumoria/releases/download/")) return;
                File dir = new File(app.getCacheDir(), "updates");
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                File apk = new File(dir, "Rumoria-" + tag.replaceAll("[^0-9.]", "") + ".apk");
                if (!(apk.isFile() && sha256(apk).equalsIgnoreCase(digest.substring(7)))) {
                    download(url, apk);
                    if (!sha256(apk).equalsIgnoreCase(digest.substring(7))) {
                        //noinspection ResultOfMethodCallIgnored
                        apk.delete();
                        throw new Exception("El archivo descargado no coincide con el publicado.");
                    }
                }
                a.runOnUiThread(() -> offer(a, tag, apk));
            } catch (Exception e) {
                Log.w(TAG, "update", e);
                if (asked) toast(a, "No se pudo buscar la actualización.");
            } finally {
                busy = false;
            }
        }, "rumoria-update").start();
    }

    private static void offer(Activity a, String tag, File apk) {
        if (a.isFinishing() || a.isDestroyed()) return;
        new AlertDialog.Builder(a)
            .setTitle("Rumoria " + tag.replaceFirst("^v", "") + " está lista")
            .setMessage("Se instala encima de esta versión: tus listas, favoritas e historial se quedan.")
            .setPositiveButton("Instalar", (d, w) -> install(a, tag, apk))
            .setNegativeButton("Más tarde", null)
            .show();
    }

    /** Back from Android's settings with the permission: the offer comes again. */
    static void resume(Activity a) {
        if (pendingApk == null || !pendingApk.isFile()) return;
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) return;
        String tag = pendingTag;
        File apk = pendingApk;
        pendingTag = null;
        pendingApk = null;
        offer(a, tag, apk);
    }

    private static void install(Activity a, String tag, File apk) {
        // Android asks once to let Rumoria install its own updates.
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            pendingApk = apk;
            pendingTag = tag;
            toast(a, "Permite a Rumoria instalar sus actualizaciones y vuelve atrás.");
            a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
            return;
        }
        Uri uri = FileProvider.getUriForFile(a, a.getPackageName() + ".updates", apk);
        Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        a.startActivity(i);
    }

    private static void toast(Activity a, String text) {
        a.runOnUiThread(() -> Toast.makeText(a, text, Toast.LENGTH_LONG).show());
    }

    private static HttpURLConnection connect(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15_000);
        c.setReadTimeout(30_000);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        c.setRequestProperty("User-Agent", "Rumoria-Android");
        return c;
    }

    private static byte[] get(String url, int max) throws Exception {
        HttpURLConnection c = connect(url);
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); if (out.size() > max) throw new Exception("Demasiado grande"); }
            return out.toByteArray();
        }
    }

    /** GitHub sends the file from its own storage (a redirect, https only). */
    private static void download(String url, File to) throws Exception {
        String at = url;
        for (int i = 0; i < 5; i++) {
            HttpURLConnection c = connect(at);
            c.setInstanceFollowRedirects(false);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String next = c.getHeaderField("Location");
                if (next == null || !next.toLowerCase(Locale.ROOT).startsWith("https://")) throw new Exception("Redirección no válida");
                at = next;
                continue;
            }
            if (code != 200) throw new Exception("HTTP " + code);
            File tmp = new File(to.getPath() + ".part");
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[64 * 1024];
                long total = 0;
                int n;
                while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); total += n; if (total > 600L * 1024 * 1024) throw new Exception("Demasiado grande"); }
            }
            if (!tmp.renameTo(to)) throw new Exception("No se pudo guardar");
            return;
        }
        throw new Exception("Demasiadas redirecciones");
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new java.io.FileInputStream(f)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder s = new StringBuilder();
        for (byte b : md.digest()) s.append(String.format("%02x", b));
        return s.toString();
    }
}
