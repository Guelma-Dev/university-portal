package dz.guelma.portal;

import android.app.DownloadManager;
import android.content.Context;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Arrays;

/**
 * UpdatePlugin — sideload update pipeline for manually distributed APKs.
 *
 * Flow owned here: enqueue/resume system download (DownloadManager, survives
 * process death) → verify (size, SHA-256, package id, signature, version) →
 * install via the modern PackageInstaller session API (system confirmation
 * is shown by Android itself; nothing is bypassed).
 *
 * The UI layer (js/portal-update.js) owns manifest fetching, version
 * comparison and all user-facing states. Swap this provider for Play
 * In-App Updates later without touching that UI.
 */
@CapacitorPlugin(name = "UpdatePlugin")
public class UpdatePlugin extends Plugin {

    static final String PREFS = "portal_update";
    private static volatile UpdatePlugin instance;

    private UpdateDownloadReceiver downloadReceiver;

    @Override
    public void load() {
        instance = this;
        try {
            if (downloadReceiver == null) {
                downloadReceiver = new UpdateDownloadReceiver();
                getContext().registerReceiver(downloadReceiver,
                    new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
            }
        } catch (Exception ignored) {}
    }

    static void emit(String event, JSObject data) {
        try {
            UpdatePlugin p = instance;
            if (p != null) p.notifyListeners(event, data);
        } catch (Exception ignored) {}
    }

    // ---------- installed version (never hardcoded in UI) ----------

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            long vc;
            if (Build.VERSION.SDK_INT >= 28) vc = pi.getLongVersionCode();
            else vc = pi.versionCode;
            JSObject r = new JSObject();
            r.put("versionName", pi.versionName != null ? pi.versionName : "");
            r.put("versionCode", vc);
            r.put("packageId", ctx.getPackageName());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("version unavailable: " + e.getMessage());
        }
    }

    // ---------- download (system DownloadManager) ----------

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String url = call.getString("url", "");
        long versionCode = 0;
        try { Long v = call.getLong("versionCode"); if (v != null) versionCode = v; } catch (Exception ignored) {}
        if (url.isEmpty() || versionCode <= 0) {
            call.reject("bad download spec");
            return;
        }
        Uri uri;
        try {
            uri = Uri.parse(url);
        } catch (Exception e) {
            call.reject("bad download url");
            return;
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getHost().isEmpty()) {
            call.reject("update url must be https");
            return;
        }
        try {
            Context ctx = getContext();
            cleanupExcept(ctx, versionCode);
            File dest = destFile(ctx, versionCode);
            if (dest == null) {
                call.reject("storage unavailable");
                return;
            }
            if (dest.getParentFile() != null) dest.getParentFile().mkdirs();
            if (dest.exists()) dest.delete();
            DownloadManager.Request req = new DownloadManager.Request(uri);
            req.setAllowedOverMetered(true);
            req.setAllowedOverRoaming(false);
            // A system progress notification: hiding it needs a signature-level
            // permission regular apps cannot hold (SecurityException).
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            // Flat filename: some firmware rejects subdirectories in the
            // download destination. Cleanup still sweeps legacy subdirs.
            req.setDestinationInExternalFilesDir(ctx, android.os.Environment.DIRECTORY_DOWNLOADS,
                "portal-update-" + versionCode + ".apk");
            req.setMimeType("application/vnd.android.package-archive");
            DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) {
                call.reject("download service unavailable");
                return;
            }
            long id = dm.enqueue(req);
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putLong("dl_id_" + versionCode, id)
                .putString("dl_url_" + versionCode, url)
                .apply();
            JSObject r = new JSObject();
            r.put("downloadId", id);
            call.resolve(r);
        } catch (SecurityException se) {
            call.reject("download blocked: " + se.getMessage());
        } catch (Exception e) {
            call.reject("download failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void pollDownload(PluginCall call) {
        long id = 0;
        try { Long v = call.getLong("downloadId"); if (v != null) id = v; } catch (Exception ignored) {}
        JSObject r = new JSObject();
        if (id <= 0) {
            r.put("status", "unknown");
            call.resolve(r);
            return;
        }
        DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) {
            r.put("status", "failed");
            call.resolve(r);
            return;
        }
        Cursor c = null;
        try {
            c = dm.query(new DownloadManager.Query().setFilterById(id));
            if (c == null || !c.moveToFirst()) {
                r.put("status", "unknown");
                call.resolve(r);
                return;
            }
            int st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long soFar = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            switch (st) {
                case DownloadManager.STATUS_RUNNING:
                case DownloadManager.STATUS_PENDING:
                case DownloadManager.STATUS_PAUSED:
                    r.put("status", "downloading");
                    break;
                case DownloadManager.STATUS_SUCCESSFUL:
                    r.put("status", "complete");
                    break;
                default:
                    r.put("status", "failed");
                    try {
                        int reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                        r.put("reason", reason);
                    } catch (Exception ignored) {}
                    break;
            }
            r.put("bytesSoFar", soFar);
            r.put("bytesTotal", total);
            call.resolve(r);
        } catch (Exception e) {
            r.put("status", "failed");
            call.resolve(r);
        } finally {
            if (c != null) { try { c.close(); } catch (Exception ignored) {} }
        }
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        long id = 0;
        try { Long v = call.getLong("downloadId"); if (v != null) id = v; } catch (Exception ignored) {}
        try {
            if (id > 0) {
                DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) dm.remove(id);
            }
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("cancel failed: " + e.getMessage());
        }
    }

    // ---------- downloaded-file bookkeeping ----------

    static File destFile(Context ctx, long versionCode) {
        File base = null;
        try {
            base = ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
        } catch (Exception ignored) {}
        if (base == null) base = ctx.getCacheDir();
        return new File(base, "portal-update-" + versionCode + ".apk");
    }

    static void cleanupExcept(Context ctx, long keepVersionCode) {
        String keep = "portal-update-" + keepVersionCode + ".apk";
        String legacyKeep = "app-" + keepVersionCode + ".apk";
        java.util.List<File> dirs = new java.util.ArrayList<>();
        try {
            File ext = ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
            if (ext != null) {
                dirs.add(ext);
                dirs.add(new File(ext, "updates"));
            }
        } catch (Exception ignored) {}
        try {
            dirs.add(ctx.getCacheDir());
            dirs.add(new File(ctx.getCacheDir(), "updates"));
        } catch (Exception ignored) {}
        for (File dir : dirs) {
            File[] fs = dir == null ? null : dir.listFiles();
            if (fs == null) continue;
            for (File f : fs) {
                String n = f.getName();
                boolean ours = (n.startsWith("portal-update-") || n.startsWith("app-")) && n.endsWith(".apk");
                if (ours && !n.equals(keep) && !n.equals(legacyKeep)) {
                    try { f.delete(); } catch (Exception ignored) {}
                }
            }
        }
    }

    @PluginMethod
    public void getDownloadedUpdate(PluginCall call) {
        long versionCode = 0;
        try { Long v = call.getLong("versionCode"); if (v != null) versionCode = v; } catch (Exception ignored) {}
        JSObject r = new JSObject();
        try {
            if (versionCode > 0) {
                File f = destFile(getContext(), versionCode);
                if (f.exists() && f.length() > 1024 * 1024) {
                    r.put("present", true);
                    r.put("size", f.length());
                    call.resolve(r);
                    return;
                }
            }
        } catch (Exception ignored) {}
        r.put("present", false);
        call.resolve(r);
    }

    // ---------- verify + install (PackageInstaller session API) ----------

    /** Chunked fallback handoff: the JS layer streams the APK (fetched over
     *  WebView HTTPS) in ~1.2MB base64 parts because a single multi-MB
     *  bridge string is unreliable on some WebViews. Parts append to the
     *  same verified location; installCommit runs the identical
     *  verify → compatibility → PackageInstaller path as verifyAndInstall. */
    @PluginMethod
    public void installBegin(PluginCall call) {
        long versionCode = 0;
        try { Long v = call.getLong("versionCode"); if (v != null) versionCode = v; } catch (Exception ignored) {}
        if (versionCode <= 0) {
            call.reject("bad install spec");
            return;
        }
        try {
            Context ctx = getContext();
            cleanupExcept(ctx, versionCode);
            File apk = destFile(ctx, versionCode);
            if (apk.getParentFile() != null) apk.getParentFile().mkdirs();
            if (apk.exists() && !apk.delete()) {
                call.reject("storage unavailable");
                return;
            }
            if (!apk.createNewFile()) {
                call.reject("storage unavailable");
                return;
            }
            JSObject r = new JSObject();
            r.put("ready", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("storage unavailable");
        }
    }

    @PluginMethod
    public void installAppend(PluginCall call) {
        long versionCode = 0;
        try { Long v = call.getLong("versionCode"); if (v != null) versionCode = v; } catch (Exception ignored) {}
        String part = call.getString("part", "");
        if (versionCode <= 0 || part == null || part.isEmpty()) {
            call.reject("bad chunk");
            return;
        }
        try {
            File apk = destFile(getContext(), versionCode);
            byte[] raw = android.util.Base64.decode(part, android.util.Base64.DEFAULT);
            java.io.FileOutputStream fos = null;
            try {
                fos = new java.io.FileOutputStream(apk, true);
                fos.write(raw);
            } finally {
                if (fos != null) { try { fos.close(); } catch (Exception ignored) {} }
            }
            JSObject r = new JSObject();
            r.put("written", apk.length());
            call.resolve(r);
        } catch (OutOfMemoryError oom) {
            call.reject("install failed: out of memory");
        } catch (Exception e) {
            call.reject("install failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void installCommit(PluginCall call) {
        long versionCode = 0;
        try { Long v = call.getLong("versionCode"); if (v != null) versionCode = v; } catch (Exception ignored) {}
        String sha256 = call.getString("sha256", "");
        if (versionCode <= 0) {
            call.reject("bad install spec");
            return;
        }
        try {
            Context ctx = getContext();
            File apk = destFile(ctx, versionCode);
            String problem = verifyApkFile(ctx, apk, versionCode, sha256);
            if (problem != null) {
                call.reject(problem);
                return;
            }
            UpdateInstaller.commit(ctx, apk);
            JSObject r = new JSObject();
            r.put("status", "pending_user_action");
            call.resolve(r);
        } catch (SecurityException se) {
            call.reject("installation blocked by Android");
        } catch (Exception e) {
            call.reject("install failed: " + e.getMessage());
        }
    }

    /** Truth gate: size → checksum, no install. The UI may only show
     *  DOWNLOADED after this returns valid. */
    @PluginMethod
    public void validateDownload(PluginCall call) {
        long versionCode = 0;
        try { Long v = call.getLong("versionCode"); if (v != null) versionCode = v; } catch (Exception ignored) {}
        String sha256 = call.getString("sha256", "");
        JSObject r = new JSObject();
        try {
            File apk = destFile(getContext(), versionCode);
            if (versionCode <= 0 || !apk.exists() || apk.length() <= 1024 * 1024) {
                r.put("valid", false);
                r.put("reason", "incomplete");
                call.resolve(r);
                return;
            }
            if (sha256 != null && !sha256.trim().isEmpty()) {
                String actual = sha256Of(apk);
                if (!sha256.trim().equalsIgnoreCase(actual)) {
                    try { apk.delete(); } catch (Exception ignored) {}
                    r.put("valid", false);
                    r.put("reason", "checksum");
                    call.resolve(r);
                    return;
                }
            }
            r.put("valid", true);
            r.put("size", apk.length());
            call.resolve(r);
        } catch (Exception e) {
            r.put("valid", false);
            r.put("reason", "incomplete");
            call.resolve(r);
        }
    }

    /** Best-effort removal of a partial file so retries start clean. */
    @PluginMethod
    public void discardPartial(PluginCall call) {
        long versionCode = 0;
        try { Long v = call.getLong("versionCode"); if (v != null) versionCode = v; } catch (Exception ignored) {}
        try {
            if (versionCode > 0) {
                File apk = destFile(getContext(), versionCode);
                if (apk.exists()) apk.delete();
            }
        } catch (Exception ignored) {}
        JSObject r = new JSObject();
        r.put("discarded", true);
        call.resolve(r);
    }

    /** Shared gate: size → checksum → compatibility. Null = installable. */
    static String verifyApkFile(Context ctx, File apk, long versionCode, String sha256) {
        if (!apk.exists() || apk.length() <= 1024 * 1024) return "apk missing or incomplete";
        try {
            if (sha256 != null && !sha256.trim().isEmpty()) {
                String actual = sha256Of(apk);
                if (!sha256.trim().equalsIgnoreCase(actual)) {
                    try { apk.delete(); } catch (Exception ignored) {}
                    return "checksum mismatch";
                }
            }
        } catch (Exception e) {
            return "checksum mismatch";
        }
        return compatibilityProblem(ctx, apk, versionCode);
    }

    public void verifyAndInstall(PluginCall call) {
        long versionCode = 0;
        try { Long v = call.getLong("versionCode"); if (v != null) versionCode = v; } catch (Exception ignored) {}
        String sha256 = call.getString("sha256", "");
        if (versionCode <= 0) {
            call.reject("bad install spec");
            return;
        }
        try {
            Context ctx = getContext();
            File apk = destFile(ctx, versionCode);
            String problem = verifyApkFile(ctx, apk, versionCode, sha256);
            if (problem != null) {
                call.reject(problem);
                return;
            }
            UpdateInstaller.commit(ctx, apk);
            JSObject r = new JSObject();
            r.put("status", "pending_user_action");
            call.resolve(r);
        } catch (SecurityException se) {
            call.reject("installation blocked by Android");
        } catch (Exception e) {
            call.reject("install failed: " + e.getMessage());
        }
    }

    /** @return null when installable, otherwise a user-facing reason key. */
    static String compatibilityProblem(Context ctx, File apk, long expectedVersionCode) {
        try {
            PackageManager pm = ctx.getPackageManager();
            PackageInfo archive;
            if (Build.VERSION.SDK_INT >= 28) {
                archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(),
                    PackageManager.GET_SIGNATURES | PackageManager.GET_SIGNING_CERTIFICATES);
            } else {
                archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNATURES);
            }
            if (archive == null || archive.packageName == null) return "invalid APK";
            if (!archive.packageName.equals(ctx.getPackageName())) return "incompatible APK";
            long avc = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
            if (avc != expectedVersionCode) return "incompatible APK";
            long installed = installedVersionCode(ctx);
            if (avc <= installed) return "incompatible APK";
            if (!sameSignature(ctx, pm, archive)) return "incompatible APK";
            return null;
        } catch (Exception e) {
            return "invalid APK";
        }
    }

    static long installedVersionCode(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= 28) return pi.getLongVersionCode();
            return pi.versionCode;
        } catch (Exception e) {
            return -1;
        }
    }

    static boolean sameSignature(Context ctx, PackageManager pm, PackageInfo archive) {
        try {
            Signature[] mine;
            Signature[] theirs;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo p = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                mine = (p.signingInfo != null && p.signingInfo.hasMultipleSigners())
                    ? p.signingInfo.getApkContentsSigners() : p.signingInfo.getSigningCertificateHistory();
                theirs = (archive.signingInfo != null && archive.signingInfo.hasMultipleSigners())
                    ? archive.signingInfo.getApkContentsSigners() : archive.signingInfo.getSigningCertificateHistory();
            } else {
                PackageInfo p = pm.getPackageInfo(ctx.getPackageName(), PackageManager.GET_SIGNATURES);
                mine = p.signatures;
                theirs = archive.signatures;
            }
            if (mine == null || theirs == null || mine.length == 0 || theirs.length == 0) return false;
            for (Signature s : mine) {
                for (Signature t : theirs) {
                    if (Arrays.equals(s.toByteArray(), t.toByteArray())) return true;
                }
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    static String sha256Of(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) md.update(buf, 0, n);
        }
        byte[] d = md.digest();
        StringBuilder sb = new StringBuilder(d.length * 2);
        for (byte b : d) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
