package dz.guelma.portal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/** Foreground host for the sideload update pipeline (Morphe-style).
 *
 *  Why it exists: a plain background download/install gets silently
 *  killed by Doze / app-standby on many firmwares. Running as a
 *  foreground service with a visible progress notification + a partial
 *  wake lock keeps the pipeline alive until verify/commit finishes.
 *
 *  The JS layer drives it: updateStarted → updateProgress* →
 *  updateFinished. Every entry is best-effort and never throws. */
public class UpdateForegroundService extends Service {

    static final String CH = "portal_updates";
    static final int NID = 4101;

    static final String ACT_START = "dz.guelma.portal.UPDATE_FG_START";
    static final String ACT_PROG = "dz.guelma.portal.UPDATE_FG_PROG";
    static final String ACT_STOP = "dz.guelma.portal.UPDATE_FG_STOP";

    private static volatile PowerManager.WakeLock lock;

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            nm.createNotificationChannel(
                new NotificationChannel(CH, "تحديثات التطبيق", NotificationManager.IMPORTANCE_LOW));
        } catch (Exception ignored) {}
    }

    static void acquireLock(Context ctx) {
        try {
            if (lock != null && lock.isHeld()) return;
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "portal:update");
            lock.setReferenceCounted(false);
            lock.acquire(10 * 60 * 1000L); // fail-safe timeout: never leak
        } catch (Exception ignored) {}
    }

    static void releaseLock() {
        try {
            if (lock != null && lock.isHeld()) lock.release();
        } catch (Exception ignored) {}
        lock = null;
    }

    /** One-shot wake lock for short critical sections (session commit). */
    static void holdBriefly(Context ctx, long timeoutMs) {
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            PowerManager.WakeLock w = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "portal:update-commit");
            w.setReferenceCounted(false);
            w.acquire(timeoutMs);
        } catch (Exception ignored) {}
    }

    /** phase: "download" or "install". */
    public static void start(Context ctx, String versionName, String phase) {
        try {
            ensureChannel(ctx);
            acquireLock(ctx);
            Intent i = new Intent(ctx, UpdateForegroundService.class).setAction(ACT_START);
            i.putExtra("version", versionName == null ? "" : versionName);
            i.putExtra("phase", phase == null ? "download" : phase);
            ContextCompat.startForegroundService(ctx, i);
        } catch (Exception ignored) {}
    }

    public static void progress(Context ctx, long soFar, long total) {
        try {
            Intent i = new Intent(ctx, UpdateForegroundService.class).setAction(ACT_PROG);
            i.putExtra("soFar", soFar);
            i.putExtra("total", total);
            ctx.startService(i);
        } catch (Exception ignored) {}
    }

    public static void stop(Context ctx) {
        try {
            ctx.startService(new Intent(ctx, UpdateForegroundService.class).setAction(ACT_STOP));
        } catch (Exception ignored) {}
        releaseLock();
    }

    private String version = "";
    private String phase = "download";
    private boolean foreground = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (intent == null) return START_NOT_STICKY;
            String a = intent.getAction();
            if (ACT_STOP.equals(a)) {
                try { stopForeground(true); } catch (Exception ignored) {}
                foreground = false;
                stopSelf();
                return START_NOT_STICKY;
            }
            if (ACT_START.equals(a)) {
                String v = intent.getStringExtra("version");
                version = v == null ? "" : v;
                String p = intent.getStringExtra("phase");
                phase = (p == null || p.isEmpty()) ? "download" : p;
                acquireLock(this);
            }
            long soFar = intent.getLongExtra("soFar", Long.MIN_VALUE);
            long total = intent.getLongExtra("total", Long.MIN_VALUE);
            Notification n = build(version, phase, soFar, total);
            if (!foreground) {
                if (Build.VERSION.SDK_INT >= 29) {
                    try {
                        startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                    } catch (Exception e) {
                        startForeground(NID, n);
                    }
                } else {
                    startForeground(NID, n);
                }
                foreground = true;
            } else {
                try {
                    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm != null) nm.notify(NID, n);
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        try { stopForeground(true); } catch (Exception ignored) {}
        foreground = false;
        releaseLock();
        super.onDestroy();
    }

    private Notification build(String ver, String ph, long soFar, long total) {
        ensureChannel(this);
        String title = "تحديث بوابة الطالب" + (ver.isEmpty() ? "" : " " + ver);
        String text;
        boolean indeterminate = true;
        int progCur = 0;
        int icon = android.R.drawable.stat_sys_download;
        if ("install".equals(ph)) {
            text = "جاري تثبيت التحديث…";
            icon = android.R.drawable.stat_sys_download_done;
        } else if (total > 0 && soFar >= 0) {
            indeterminate = false;
            progCur = (int) Math.min(100, (soFar * 100) / Math.max(1, total));
            text = "جاري تنزيل التحديث… " + progCur + "%";
        } else {
            text = "جاري تنزيل التحديث…";
        }
        PendingIntent tap = null;
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            int fl = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) fl |= PendingIntent.FLAG_IMMUTABLE;
            if (launch != null) tap = PendingIntent.getActivity(this, 0, launch, fl);
        } catch (Exception ignored) {}
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CH)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(icon)
            .setOngoing(true)
            .setOnlyAlertOnce(true);
        if (tap != null) b.setContentIntent(tap);
        if ("install".equals(ph)) b.setProgress(0, 0, false);
        else if (indeterminate) b.setProgress(100, 0, true);
        else b.setProgress(100, progCur, false);
        return b.build();
    }
}
