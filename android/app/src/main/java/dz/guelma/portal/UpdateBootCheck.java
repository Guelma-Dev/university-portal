package dz.guelma.portal;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Boot-time update check (Morphe's periodic-check equivalent, minimal).
 *
 *  On BOOT_COMPLETED: fetch the update manifest, compare with the
 *  installed versionCode, and post a tap-to-open notification when a
 *  newer build exists. Runs on a daemon thread, fully best-effort:
 *  no notification permission → silent skip; any failure → silent skip. */
public final class UpdateBootCheck {

    private UpdateBootCheck() {}

    static final String MANIFEST = "https://guelma-dev.github.io/university-portal/app/update.json";
    static final String HOST = "guelma-dev.github.io";
    static final int NID = 4102;

    static void check(Context ctx) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try { doCheck(ctx.getApplicationContext()); } catch (Exception ignored) {}
            }
        });
        try { t.setDaemon(true); } catch (Exception ignored) {}
        try { t.start(); } catch (Exception ignored) {}
    }

    private static void doCheck(Context ctx) {
        HttpURLConnection c = null;
        try {
            URL u = new URL(MANIFEST);
            if (!HOST.equalsIgnoreCase(u.getHost())) return;
            c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "portal-boot-check");
            if (c.getResponseCode() != 200) return;
            byte[] body = readAll(c.getInputStream(), 65536);
            JSONObject o = new JSONObject(new String(body, "UTF-8"));
            long vc = o.optLong("versionCode", 0);
            String vn = o.optString("versionName", "");
            if (vc <= 0) return;
            if (vc <= installedCode(ctx)) return;
            notify(ctx, vn.isEmpty() ? ("v" + vc) : vn);
        } catch (Exception ignored) {
        } finally {
            if (c != null) { try { c.disconnect(); } catch (Exception ignored) {} }
        }
    }

    private static long installedCode(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= 28) return pi.getLongVersionCode();
            return pi.versionCode;
        } catch (Exception e) {
            return Long.MAX_VALUE; // unknown → never nag
        }
    }

    private static byte[] readAll(InputStream in, int cap) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
            if (out.size() > cap) throw new Exception("too large");
        }
        try { in.close(); } catch (Exception ignored) {}
        return out.toByteArray();
    }

    private static void notify(Context ctx, String versionName) {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                try {
                    if (ctx.checkSelfPermission("android.permission.POST_NOTIFICATIONS")
                            != android.content.pm.PackageManager.PERMISSION_GRANTED) return;
                } catch (Exception ignored) {}
            }
            UpdateForegroundService.ensureChannel(ctx);
            Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            PendingIntent tap = null;
            if (launch != null) {
                int fl = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= 23) fl |= PendingIntent.FLAG_IMMUTABLE;
                tap = PendingIntent.getActivity(ctx, 0, launch, fl);
            }
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, UpdateForegroundService.CH)
                .setContentTitle("تحديث بوابة الطالب متوفر")
                .setContentText("الإصدار " + versionName + " جاهز — افتح التطبيق للتنزيل")
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setAutoCancel(true);
            if (tap != null) b.setContentIntent(tap);
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NID, b.build());
        } catch (Exception ignored) {}
    }
}
