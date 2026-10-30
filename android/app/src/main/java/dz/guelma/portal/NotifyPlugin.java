package dz.guelma.portal;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Calendar;

/**
 * NotifyPlugin — local notifications + daily meal-booking scheduler.
 *
 * The WebView layer (js/portal-notify.js) owns preferences/UX; this plugin owns
 * everything that must survive outside the WebView: notification channels,
 * runtime permission, AlarmManager scheduling (persisted in SharedPreferences
 * so BOOT_COMPLETED can restore it) and result notifications.
 *
 * Booking replay needs no secret: it hits OUR backend (/api/onou/*) which
 * resolves the ministry session server-side from the stored uuid.
 */
@CapacitorPlugin(
    name = "NotifyPlugin",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class NotifyPlugin extends Plugin {

    /** Bridge numbers arrive as Integer OR Long OR Double depending on
     *  magnitude — never assume one exact type (Capacitor returns null
     *  on mismatch, which silently broke scheduling before). */
    static long numLong(com.getcapacitor.PluginCall call, String key, long def) {
        try {
            Object v = call.getData().opt(key);
            if (v instanceof Number) return ((Number) v).longValue();
            if (v instanceof String) return Long.parseLong((String) v);
        } catch (Exception ignored) {}
        return def;
    }

    static int numInt(com.getcapacitor.PluginCall call, String key, int def) {
        try {
            Object v = call.getData().opt(key);
            if (v instanceof Number) return ((Number) v).intValue();
            if (v instanceof String) return Integer.parseInt((String) v);
        } catch (Exception ignored) {}
        return def;
    }

    static final String PREFS = "portal_notify";
    static final int REQ_BOOKING = 1001;
    static final String CH_MEALS = "meals";
    static final String CH_GENERAL = "general";

    // ---------- permission ----------

    @PluginMethod
    public void areEnabled(PluginCall call) {
        boolean en = false;
        try {
            en = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        } catch (Exception ignored) {}
        JSObject r = new JSObject();
        r.put("enabled", en);
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "permResult");
    }

    @PermissionCallback
    private void permResult(PluginCall call) {
        JSObject r = new JSObject();
        boolean granted = false;
        try {
            granted = getPermissionState("notifications") == com.getcapacitor.PermissionState.GRANTED;
        } catch (Exception ignored) {}
        r.put("granted", granted);
        call.resolve(r);
    }

    // ---------- immediate ----------

    @PluginMethod
    public void notifyNow(PluginCall call) {
        String title = call.getString("title", "بوابة الطالب");
        String body = call.getString("body", "");
        String channel = call.getString("channel", CH_GENERAL);
        try {
            ensureChannels(getContext());
            show(getContext(), channel, title, body, (int) System.currentTimeMillis());
            JSObject r = new JSObject();
            r.put("shown", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("notify failed: " + e.getMessage());
        }
    }

    // ---------- schedule ----------

    @PluginMethod
    public void scheduleBooking(PluginCall call) {
        try {
            int hour = numInt(call, "hour", 18);
            int minute = numInt(call, "minute", 0);
            Context ctx = getContext();
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            p.edit()
                .putBoolean("booking_enabled", true)
                .putInt("hour", hour)
                .putInt("minute", minute)
                .putString("apiBase", call.getString("apiBase", ""))
                .putString("uuid", call.getString("uuid", ""))
                .putString("dia", call.getString("dia", ""))
                .putInt("depotId", numInt(call, "depotId", 0))
                .putString("depotName", call.getString("depotName", ""))
                .putString("meals", call.getString("meals", ""))
                .putString("mealNames", call.getString("mealNames", ""))
                .apply();
            ensureChannels(ctx);
            long triggerAt = nextTriggerMillis(hour, minute);
            boolean exact = armAlarm(ctx, triggerAt);
            JSObject r = new JSObject();
            r.put("scheduled", true);
            r.put("exact", exact);
            r.put("triggerAt", triggerAt);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("schedule failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelBooking(PluginCall call) {
        try {
            Context ctx = getContext();
            disarmAlarm(ctx);
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean("booking_enabled", false).apply();
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("cancel failed: " + e.getMessage());
        }
    }

    /** Logout wipe: drop stored identity (uuid/dia/depot/token) so the next
     *  user cannot reuse the previous student's meal context. */
    @PluginMethod
    public void wipeSession(PluginCall call) {
        try {
            Context ctx = getContext();
            disarmAlarm(ctx);
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().remove("uuid").remove("dia")
                .remove("depotId").remove("depotName")
                .remove("mealToken").apply();
            clearCredentials(ctx); // خروج صريح يمسح خزنة الدخول أيضاً
            JSObject r = new JSObject();
            r.put("wiped", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("wipe failed: " + e.getMessage());
        }
    }

    /** Persist the Progres session token so BookingReceiver can run the
     *  direct gs-api chain while the app is closed. Called on every login
     *  and session restore; cleared on logout (see wipeSession). */
    @PluginMethod
    public void saveMealSession(PluginCall call) {
        try {
            String uuid = call.getString("uuid", "");
            String token = call.getString("token", "");
            if (uuid.isEmpty() || token.isEmpty()) { call.reject("uuid+token required"); return; }
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString("mealUuid", uuid).putString("mealToken", token).apply();
            JSObject r = new JSObject();
            r.put("saved", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clearMealSession(PluginCall call) {
        try {
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().remove("mealUuid").remove("mealToken").apply();
            JSObject r = new JSObject();
            r.put("cleared", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("clear failed: " + e.getMessage());
        }
    }

    // ---------- generic one-shot reminders (timetable, extensible) ----------

    @PluginMethod
    public void scheduleReminder(PluginCall call) {
        try {
            String id = call.getString("id", "");
            String tag = call.getString("tag", "general");
            double atD = 0;
            atD = (double) numLong(call, "triggerAt", 0);
            long at = (long) atD;
            if (id.isEmpty() || at <= System.currentTimeMillis()) {
                Object raw = null;
                String rtype = "null";
                try { raw = call.getData().opt("triggerAt"); rtype = raw == null ? "null" : raw.getClass().getName(); } catch (Exception ignored) {}
                call.reject("bad reminder spec t=" + at + " now=" + System.currentTimeMillis() + " type=" + rtype + " idlen=" + id.length());
                return;
            }
            Context ctx = getContext();
            ensureChannels(ctx);
            armReminder(ctx, id, tag, at,
                call.getString("title", ""),
                call.getString("body", ""),
                call.getString("channel", CH_GENERAL));
            trackReminder(ctx, tag, id);
            JSObject r = new JSObject();
            r.put("scheduled", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("schedule failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelReminder(PluginCall call) {
        try {
            String id = call.getString("id", "");
            String tag = call.getString("tag", "general");
            if (!id.isEmpty()) {
                disarmReminder(getContext(), id);
                untrackReminder(getContext(), tag, id);
            }
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("cancel failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancelReminders(PluginCall call) {
        try {
            cancelTag(getContext(), call.getString("tag", "general"));
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("cancel failed: " + e.getMessage());
        }
    }

    static int reminderCode(String id) {
        int h = id.hashCode();
        if (h == Integer.MIN_VALUE) h = 0;
        return 30000 + (Math.abs(h) % 5000);
    }

    static void armReminder(Context ctx, String id, String tag, long at, String title, String body, String channel) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(ctx, ReminderReceiver.class);
        i.setAction("dz.guelma.portal.REMIND");
        i.putExtra("rid", id);
        i.putExtra("tag", tag);
        i.putExtra("title", title);
        i.putExtra("body", body);
        i.putExtra("channel", channel);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, reminderCode(id), i, flags);
        try {
            boolean exact = true;
            if (Build.VERSION.SDK_INT >= 31) {
                try { exact = am.canScheduleExactAlarms(); } catch (Exception ignored) { exact = false; }
            }
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException se) {
            try { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi); } catch (Exception ignored) {}
        } catch (Exception ignored) {}
    }

    static void disarmReminder(Context ctx, String id) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent i = new Intent(ctx, ReminderReceiver.class);
            i.setAction("dz.guelma.portal.REMIND");
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            am.cancel(PendingIntent.getBroadcast(ctx, reminderCode(id), i, flags));
        } catch (Exception ignored) {}
    }

    static void trackReminder(Context ctx, String tag, String id) {
        try {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            java.util.Set<String> set = new java.util.HashSet<>(p.getStringSet("remtag_" + tag, new java.util.HashSet<String>()));
            set.add(id);
            p.edit().putStringSet("remtag_" + tag, set).apply();
        } catch (Exception ignored) {}
    }

    static void untrackReminder(Context ctx, String tag, String id) {
        try {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            java.util.Set<String> set = new java.util.HashSet<>(p.getStringSet("remtag_" + tag, new java.util.HashSet<String>()));
            if (set.remove(id)) p.edit().putStringSet("remtag_" + tag, set).apply();
        } catch (Exception ignored) {}
    }

    static void cancelTag(Context ctx, String tag) {
        try {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            java.util.Set<String> set = p.getStringSet("remtag_" + tag, null);
            if (set != null) {
                for (String id : new java.util.ArrayList<>(set)) disarmReminder(ctx, id);
                p.edit().remove("remtag_" + tag).apply();
            }
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void getBooking(PluginCall call) {        try {
            SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!p.getBoolean("booking_enabled", false)) {
                call.resolve(new JSObject());
                return;
            }
            JSObject r = new JSObject();
            r.put("enabled", true);
            r.put("hour", p.getInt("hour", 18));
            r.put("minute", p.getInt("minute", 0));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage());
        }
    }


    // ---------- persistent-session credential vault ----------
    // The ministry JWT always dies server-side; «stay signed in» is
    // implemented as silent re-login with the credentials the user kept
    // on THIS device via «تذكرني». The password is encrypted with an
    // Android Keystore AES-256 key that never leaves the device;
    // SharedPreferences only ever holds ciphertext. Explicit logout
    // (JS progresLogout → clearProgresCredentials, or wipeSession)
    // wipes the vault — that is the only way the session truly ends,
    // apart from a ministry-side password change (login then returns
    // 400/401 and the vault clears itself).

    private static final String CRED_ALIAS = "portal_cred_key";
    private static final String CRED_BLOB = "credBlob";
    private static final String CRED_UUID = "credUuid";
    private static final String CRED_BASE = "credBase";
    static final String FALLBACK_BASE = "https://university-portal-gv78.onrender.com";

    private static javax.crypto.SecretKey credKey() throws Exception {
        java.security.KeyStore ks = java.security.KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        java.security.KeyStore.SecretKeyEntry e =
            (java.security.KeyStore.SecretKeyEntry) ks.getEntry(CRED_ALIAS, null);
        if (e != null) return e.getSecretKey();
        javax.crypto.KeyGenerator kg = javax.crypto.KeyGenerator.getInstance(
            android.security.keystore.KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new android.security.keystore.KeyGenParameterSpec.Builder(CRED_ALIAS,
                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT
                    | android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return kg.generateKey();
    }

    private static boolean credSupported() {
        return Build.VERSION.SDK_INT >= 23; // KeyGenParameterSpec needs API 23+
    }

    static boolean saveCredentials(Context ctx, String user, String pass, String uuid, String base) {
        if (!credSupported()) return false;
        try {
            javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
            c.init(javax.crypto.Cipher.ENCRYPT_MODE, credKey());
            byte[] ct = c.doFinal((user + "\u0001" + pass).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            String blob = android.util.Base64.encodeToString(c.getIV(), android.util.Base64.NO_WRAP)
                + ":" + android.util.Base64.encodeToString(ct, android.util.Base64.NO_WRAP);
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(CRED_BLOB, blob)
                .putString(CRED_UUID, uuid == null ? "" : uuid)
                .putString(CRED_BASE, base == null ? "" : base)
                .apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** @return [username, password] or null when no usable vault entry. */
    static String[] loadCredentials(Context ctx) {
        try {
            if (!credSupported()) return null;
            String blob = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CRED_BLOB, "");
            if (blob == null || blob.isEmpty()) return null;
            int i = blob.indexOf(':');
            if (i <= 0) return null;
            byte[] iv = android.util.Base64.decode(blob.substring(0, i), android.util.Base64.NO_WRAP);
            byte[] ct = android.util.Base64.decode(blob.substring(i + 1), android.util.Base64.NO_WRAP);
            javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");
            c.init(javax.crypto.Cipher.DECRYPT_MODE, credKey(), new javax.crypto.spec.GCMParameterSpec(128, iv));
            String plain = new String(c.doFinal(ct), java.nio.charset.StandardCharsets.UTF_8);
            int sep = plain.indexOf('\u0001');
            if (sep <= 0) return null;
            return new String[]{ plain.substring(0, sep), plain.substring(sep + 1) };
        } catch (Exception e) {
            return null;
        }
    }

    static void clearCredentials(Context ctx) {
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove(CRED_BLOB).remove(CRED_UUID).remove(CRED_BASE).apply();
        } catch (Exception ignored) {}
    }

    static boolean hasCredentials(Context ctx) {
        try {
            String b = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CRED_BLOB, "");
            return b != null && !b.isEmpty();
        } catch (Exception e) { return false; }
    }

    /** Outcome of a silent re-login attempt. error: 0 ok,
     *  1 no credentials, 2 credentials rejected (password changed —
     *  vault self-clears), 3 network/other, 4 account mismatch. */
    static class RefreshResult {
        String token, uuid, etab, name;
        int error = 3;
    }

    /** Silent re-login through OUR backend (POST /api/progres/login —
     *  the exact route the app login uses). On success the fresh token
     *  also re-arms the background meal booker (mealToken/mealUuid). */
    static RefreshResult refreshProgres(Context ctx, String expectedUuid) {
        RefreshResult out = new RefreshResult();
        String[] creds = loadCredentials(ctx);
        if (creds == null) { out.error = 1; return out; }
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String base = p.getString(CRED_BASE, "");
        if (base == null || base.isEmpty()) base = FALLBACK_BASE;
        java.net.HttpURLConnection c = null;
        try {
            org.json.JSONObject body = new org.json.JSONObject();
            body.put("username", creds[0]);
            body.put("password", creds[1]);
            c = (java.net.HttpURLConnection) new java.net.URL(base + "/api/progres/login").openConnection();
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setConnectTimeout(25000);
            c.setReadTimeout(45000);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("Accept", "application/json");
            byte[] bytes = body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            try (java.io.OutputStream os = c.getOutputStream()) { os.write(bytes); }
            int code = c.getResponseCode();
            if (code == 400 || code == 401) {
                clearCredentials(ctx);
                out.error = 2;
                return out;
            }
            if (code < 200 || code >= 300) { out.error = 3; return out; }
            String text = readAllText(c.getInputStream());
            org.json.JSONObject d = new org.json.JSONObject(text);
            String token = d.optString("token", "");
            String uuid = d.optString("uuid", "");
            if (token.isEmpty() || uuid.isEmpty()) { out.error = 3; return out; }
            if (expectedUuid != null && !expectedUuid.isEmpty() && !expectedUuid.equals(uuid)) {
                out.error = 4;
                return out;
            }
            Object et = d.opt("etablissementId");
            out.token = token;
            out.uuid = uuid;
            out.etab = et == null ? "" : String.valueOf(et);
            out.name = d.optString("userName", "");
            p.edit().putString("mealToken", token).putString("mealUuid", uuid).apply();
            out.error = 0;
            return out;
        } catch (Exception e) {
            out.error = 3;
            return out;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String readAllText(java.io.InputStream in) throws Exception {
        if (in == null) return "";
        byte[] buf = new byte[8192];
        StringBuilder sb = new StringBuilder();
        int n;
        while ((n = in.read(buf)) != -1) sb.append(new String(buf, 0, n, java.nio.charset.StandardCharsets.UTF_8));
        return sb.toString();
    }

    @PluginMethod
    public void saveProgresCredentials(PluginCall call) {
        try {
            String user = call.getString("username", "");
            String pass = call.getString("password", "");
            if (user.isEmpty() || pass.isEmpty()) { call.reject("username+password required"); return; }
            boolean ok = saveCredentials(getContext(), user, pass,
                call.getString("uuid", ""), call.getString("apiBase", ""));
            JSObject r = new JSObject();
            r.put("saved", ok);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clearProgresCredentials(PluginCall call) {
        try {
            clearCredentials(getContext());
            JSObject r = new JSObject();
            r.put("cleared", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("clear failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void hasProgresCredentials(PluginCall call) {
        JSObject r = new JSObject();
        r.put("present", hasCredentials(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void refreshProgresSession(PluginCall call) {
        final String expected = call.getString("expectedUuid", "");
        final Context ctx = getContext().getApplicationContext();
        new Thread(() -> {
            RefreshResult rr = refreshProgres(ctx, expected);
            if (rr.error == 0) {
                JSObject r = new JSObject();
                r.put("token", rr.token);
                r.put("uuid", rr.uuid);
                r.put("etablissementId", rr.etab);
                r.put("userName", rr.name);
                call.resolve(r);
            } else {
                call.reject(rr.error == 1 ? "no-credentials"
                    : rr.error == 2 ? "bad-credentials"
                    : rr.error == 4 ? "account-mismatch" : "network");
            }
        }).start();
    }

    // ---------- static helpers (receivers use these without a bridge) ----------

    static long nextTriggerMillis(int hour, int minute) {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        c.set(Calendar.HOUR_OF_DAY, hour);
        c.set(Calendar.MINUTE, minute);
        if (c.getTimeInMillis() <= System.currentTimeMillis()) {
            c.add(Calendar.DAY_OF_YEAR, 1);
        }
        return c.getTimeInMillis();
    }

    static PendingIntent bookingIntent(Context ctx) {
        Intent i = new Intent(ctx, BookingReceiver.class);
        i.setAction("dz.guelma.portal.BOOK_MEALS");
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, REQ_BOOKING, i, flags);
    }

    /** @return true when an exact alarm was armed, false on inexact fallback. */
    static boolean armAlarm(Context ctx, long triggerAt) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;
        PendingIntent pi = bookingIntent(ctx);
        boolean exact = false;
        if (Build.VERSION.SDK_INT >= 31) {
            try { exact = am.canScheduleExactAlarms(); } catch (Exception ignored) {}
        } else {
            exact = true;
        }
        try {
            if (exact) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        } catch (SecurityException se) {
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } catch (Exception ignored) { return false; }
            return false;
        } catch (Exception ignored) {
            return false;
        }
        return exact;
    }

    static void disarmAlarm(Context ctx) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am != null) am.cancel(bookingIntent(ctx));
        } catch (Exception ignored) {}
    }

    /** Re-arm from persisted prefs (boot restore / daily rollover). */
    static void rescheduleIfEnabled(Context ctx) {
        try {
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!p.getBoolean("booking_enabled", false)) return;
            ensureChannels(ctx);
            armAlarm(ctx, nextTriggerMillis(p.getInt("hour", 18), p.getInt("minute", 0)));
        } catch (Exception ignored) {}
    }

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            nm.createNotificationChannel(new NotificationChannel(CH_MEALS, "حجز الوجبات", NotificationManager.IMPORTANCE_DEFAULT));
            nm.createNotificationChannel(new NotificationChannel(CH_GENERAL, "تنبيهات عامة", NotificationManager.IMPORTANCE_DEFAULT));
        } catch (Exception ignored) {}
    }

    static void show(Context ctx, String channel, String title, String body, int id) {
        ensureChannels(ctx);
        Intent launch;
        try {
            launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        } catch (Exception e) {
            launch = null;
        }
        PendingIntent content = null;
        if (launch != null) {
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            content = PendingIntent.getActivity(ctx, id, launch, flags);
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_notif)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        if (content != null) b.setContentIntent(content);
        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS revoked — nothing we can do headlessly.
        } catch (Exception ignored) {}
    }
}
