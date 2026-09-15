package dz.guelma.portal;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** Commits a verified APK through a PackageInstaller session.
 *  Android itself shows any required confirmation; nothing is bypassed.
 *  Every stage is tagged (stage=...) so failures surface the EXACT step
 *  instead of a generic message. */
public final class UpdateInstaller {

    private UpdateInstaller() {}

    /** Best-effort: abandon our own stale sessions left by previous
     *  failed taps so they can never interfere with the new commit. */
    static void abandonOrphans(Context ctx) {
        try {
            PackageInstaller pi = ctx.getPackageManager().getPackageInstaller();
            for (PackageInstaller.SessionInfo s : pi.getMySessions()) {
                try { pi.abandonSession(s.getSessionId()); } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
    }

    static void commit(Context ctx, File apk) throws Exception {
        abandonOrphans(ctx);
        PackageInstaller pi;
        try {
            pi = ctx.getPackageManager().getPackageInstaller();
        } catch (Exception e) {
            throw new Exception("stage=installer: " + msg(e));
        }
        PackageInstaller.SessionParams params =
            new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int sessionId;
        try {
            sessionId = pi.createSession(params);
        } catch (Exception e) {
            throw new Exception("stage=create-session: " + msg(e));
        }
        PackageInstaller.Session session = null;
        try {
            try {
                session = pi.openSession(sessionId);
            } catch (Exception e) {
                throw new Exception("stage=open-session #" + sessionId + ": " + msg(e));
            }
            try (InputStream in = new FileInputStream(apk);
                 OutputStream out = session.openWrite("app", 0, -1)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                session.fsync(out);
            } catch (Exception e) {
                throw new Exception("stage=write-session #" + sessionId + ": " + msg(e));
            }
            Intent callback = new Intent(ctx, UpdateInstallReceiver.class);
            callback.setAction("dz.guelma.portal.INSTALL_STATUS");
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi2 = PendingIntent.getBroadcast(ctx, sessionId, callback, flags);
            try {
                session.commit(pi2.getIntentSender());
            } catch (Exception e) {
                throw new Exception("stage=commit-session #" + sessionId + ": " + msg(e));
            }
        } finally {
            if (session != null) {
                try { session.close(); } catch (Exception ignored) {}
            }
        }
    }

    private static String msg(Exception e) {
        try {
            String m = e.getClass().getSimpleName();
            String d = e.getMessage();
            return (d == null || d.isEmpty()) ? m : (m + ": " + d);
        } catch (Exception ignored) {
            return "unknown";
        }
    }
}
