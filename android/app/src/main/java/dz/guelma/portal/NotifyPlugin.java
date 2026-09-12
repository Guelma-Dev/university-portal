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

    /** Logout wipe: drop stored identity (uuid/dia/depot) so the next
     *  user cannot reuse the previous student's meal context. */
    @PluginMethod
    public void wipeSession(PluginCall call) {
        try {
            Context ctx = getContext();
            disarmAlarm(ctx);
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().remove("uuid").remove("dia")
                .remove("depotId").remove("depotName").apply();
            JSObject r = new JSObject();
            r.put("wiped", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("wipe failed: " + e.getMessage());
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
