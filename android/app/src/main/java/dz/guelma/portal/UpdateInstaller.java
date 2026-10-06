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

    static final String PREFS = "portal_update";
    static final String KEY_LAST_SESSION = "last_session";

    static void rememberSession(Context ctx, int sessionId) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putInt(KEY_LAST_SESSION, sessionId).apply();
        } catch (Exception ignored) {}
    }

    static int lastSession(Context ctx) {
        try {
            return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_LAST_SESSION, -1);
        } catch (Exception ignored) {
            return -1;
        }
    }

    static void commit(Context ctx, File apk) throws Exception {
        abandonOrphans(ctx);
        PackageInstaller pi;
        try {
            pi = ctx.getPackageManager().getPackageInstaller();
        } catch (Exception e) {
            throw new Exception("stage=installer: " + msg(e));
        }
        // Minimal session on purpose: the APK content already declares its
        // target package, the caller uid is the default originator, and
        // USER_ACTION_REQUIRED is already the default for apps without
        // UPDATE_PACKAGES_WITHOUT_USER_ACTION. Every extra attribution
        // signal (setAppPackageName / setOriginatingUid / setPackageSource)
        // is one more thing a strict ROM guard can disagree with — ColorOS
        // silently kills such sessions pre-confirmation. Verified Morphe
        // pattern: minimal session first, escalate on silent refusal.
        PackageInstaller.SessionParams params =
            new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int sessionId;
        try {
            sessionId = pi.createSession(params);
            rememberSession(ctx, sessionId);
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
                 OutputStream out = session.openWrite("app", 0, apk.length())) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                session.fsync(out);
            } catch (Exception e) {
                throw new Exception("stage=write-session #" + sessionId + ": " + msg(e));
            }
            Intent callback = new Intent(ctx, UpdateInstallReceiver.class);
            callback.setAction("dz.guelma.portal.INSTALL_STATUS");
            // FLAG_MUTABLE is MANDATORY here (not optional): the system
            // reports session status by filling extras into this intent at
            // send() time, and fill-in is silently ignored for immutable
            // PendingIntents (empty callback, nothing installed; targetSdk
            // 35+ even throws). Pre-31 has no mutability flag and is mutable
            // by default, so plain UPDATE_CURRENT there.
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
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
