package dz.guelma.portal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/** Fires the persisted daily meal booking, verifies against the reservations
 *  list, notifies the ACTUAL result, then rolls the alarm to the next day. */
public class BookingReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try {
                BookingRunner.run(context.getApplicationContext());
            } catch (Exception ignored) {
            } finally {
                pr.finish();
            }
        }).start();
    }
}

class BookingRunner {

    static void run(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(NotifyPlugin.PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("booking_enabled", false)) return;

        String apiBase = p.getString("apiBase", "");
        String uuid = p.getString("uuid", "");
        String dia = p.getString("dia", "");
        int depotId = p.getInt("depotId", 0);
        String mealsCsv = p.getString("meals", "");
        String mealNames = p.getString("mealNames", "");
        if (apiBase.isEmpty() || uuid.isEmpty() || depotId <= 0 || mealsCsv.isEmpty()) {
            NotifyPlugin.show(ctx, NotifyPlugin.CH_MEALS, "حجز الوجبات", "تعذر حجز الوجبة — بيانات الحجز التلقائي ناقصة", 7101);
            NotifyPlugin.rescheduleIfEnabled(ctx);
            return;
        }

        String tomorrow = dayPlus(1);
        List<Integer> meals = parseMeals(mealsCsv);
        String failReason = null;
        try {
            for (int mt : meals) {
                JSONObject body = new JSONObject();
                body.put("uuid", uuid);
                body.put("dia", dia);
                body.put("menu_type", mt);
                body.put("idDepot", depotId);
                JSONArray dates = new JSONArray();
                dates.put(tomorrow);
                body.put("dates", dates);
                postJson(apiBase + "/api/onou/reserve", body.toString());
            }
        } catch (Exception e) {
            failReason = shortMsg(e.getMessage());
        }

        int confirmed = 0;
        try {
            String list = get(apiBase + "/api/onou/reservations?uuid=" + enc(uuid) + "&dia=" + enc(dia));
            confirmed = countForDate(list, tomorrow, meals);
        } catch (Exception e) {
            if (failReason == null) failReason = shortMsg(e.getMessage());
        }

        if (confirmed > 0) {
            String what = mealNames.isEmpty() ? "الوجبة" : "وجبة " + mealNames;
            NotifyPlugin.show(ctx, NotifyPlugin.CH_MEALS, "حجز الوجبات",
                confirmed == 1 ? ("تم حجز " + what + " بنجاح") : ("تم حجز " + confirmed + " وجبات بنجاح"), 7101);
        } else {
            String body = "تعذر حجز الوجبة";
            if (failReason != null && !failReason.isEmpty()) body += " — " + failReason;
            NotifyPlugin.show(ctx, NotifyPlugin.CH_MEALS, "حجز الوجبات", body, 7102);
        }

        // Daily rollover (setExact does not repeat; same ID => no duplicates).
        NotifyPlugin.rescheduleIfEnabled(ctx);
    }

    private static String dayPlus(int days) {
        Calendar c = Calendar.getInstance();
        c.add(Calendar.DAY_OF_YEAR, days);
        return String.format(Locale.US, "%04d-%02d-%02d",
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    private static List<Integer> parseMeals(String csv) {
        List<Integer> out = new ArrayList<>();
        for (String s : csv.split(",")) {
            try {
                int v = Integer.parseInt(s.trim());
                if ((v == 1 || v == 2 || v == 3) && !out.contains(v)) out.add(v);
            } catch (Exception ignored) {}
        }
        if (out.isEmpty()) out.add(2);
        return out;
    }

    private static int countForDate(String json, String date, List<Integer> meals) {
        try {
            JSONArray arr;
            String t = json.trim();
            if (t.startsWith("[")) {
                arr = new JSONArray(t);
            } else {
                JSONObject o = new JSONObject(t);
                if (!o.has("data")) return 0;
                arr = o.optJSONArray("data");
                if (arr == null) return 0;
            }
            int n = 0;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject r = arr.optJSONObject(i);
                if (r == null) continue;
                String d = r.optString("date_reserve", "");
                if (d.length() >= 10) d = d.substring(0, 10);
                if (!d.equals(date)) continue;
                int mt = r.optInt("menu_type", -1);
                if (mt == -1) { n++; continue; } // date match, type unknown
                if (meals.contains(mt)) n++;
            }
            return n;
        } catch (Exception e) {
            return 0;
        }
    }

    private static String postJson(String url, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setConnectTimeout(25000);
            c.setReadTimeout(45000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("Accept", "application/json");
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            java.io.InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            String resp = readAll(in);
            if (code < 200 || code >= 300) throw new Exception("status-" + code + " " + resp);
            return resp;
        } finally {
            c.disconnect();
        }
    }

    private static String get(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod("GET");
            c.setConnectTimeout(25000);
            c.setReadTimeout(45000);
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            java.io.InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            String resp = readAll(in);
            if (code < 200 || code >= 300) throw new Exception("status-" + code);
            return resp;
        } finally {
            c.disconnect();
        }
    }

    private static String readAll(java.io.InputStream in) throws Exception {
        if (in == null) return "";
        byte[] buf = new byte[8192];
        StringBuilder sb = new StringBuilder();
        int n;
        while ((n = in.read(buf)) != -1) sb.append(new String(buf, 0, n, StandardCharsets.UTF_8));
        return sb.toString();
    }

    private static String enc(String s) {
        try { return java.net.URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    private static String shortMsg(String m) {
        if (m == null) return "";
        m = m.trim();
        if (m.length() > 80) m = m.substring(0, 80);
        return m;
    }
}
