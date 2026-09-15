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

    // Owner-supplied gs-api integration secret (same exposure class as any
    // in-app key: readable from the APK, signs OUR gs-api calls only).
    private static final String GS_SECRET = "pUzHUW2WX54uCzhO8JC2eQ6g1Ol21upw";
    private static final String WEBETU = "https://api-webetu.mesrs.dz/api/infos";
    private static final String GS = "https://gs-api.onou.dz";
    private static final long GS_TTL_MS = 20L * 3600 * 1000;

    static void run(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(NotifyPlugin.PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("booking_enabled", false)) return;

        String uuid = p.getString("uuid", "");
        String dia = p.getString("dia", "");
        String token = p.getString("mealToken", "");
        int depotId = p.getInt("depotId", 0);
        String mealsCsv = p.getString("meals", "");
        String mealNames = p.getString("mealNames", "");
        if (uuid.isEmpty() || token.isEmpty() || depotId <= 0 || mealsCsv.isEmpty()) {
            String body = token.isEmpty() && !uuid.isEmpty()
                ? "تعذر حجز الوجبة — سجل الدخول في التطبيق أولاً"
                : "تعذر حجز الوجبة — بيانات الحجز التلقائي ناقصة";
            NotifyPlugin.show(ctx, NotifyPlugin.CH_MEALS, "حجز الوجبات", body, 7101);
            NotifyPlugin.rescheduleIfEnabled(ctx);
            return;
        }

        String tomorrow = dayPlus(1);
        List<Integer> meals = parseMeals(mealsCsv);
        String failReason = null;
        try {
            GsChain gs = new GsChain(uuid, dia, token, p);
            for (int mt : meals) {
                JSONObject body = new JSONObject();
                body.put("uuid", uuid);
                body.put("wilaya", gs.wilayaJson());
                body.put("residence", gs.residenceJson());
                body.put("token", gs.gs());
                JSONObject one = new JSONObject();
                one.put("date_reserve", tomorrow);
                one.put("menu_type", mt);
                one.put("idDepot", depotId);
                body.put("details", new JSONArray().put(one.toString()));
                gs.post("/api/reservemeal", body);
            }
            int confirmed = gs.countForDate(tomorrow, meals);
            if (confirmed > 0) {
                String what = mealNames.isEmpty() ? "الوجبة" : "وجبة " + mealNames;
                NotifyPlugin.show(ctx, NotifyPlugin.CH_MEALS, "حجز الوجبات",
                    confirmed == 1 ? ("تم حجز " + what + " بنجاح") : ("تم حجز " + confirmed + " وجبات بنجاح"), 7101);
            } else {
                NotifyPlugin.show(ctx, NotifyPlugin.CH_MEALS, "حجز الوجبات", "تعذر حجز الوجبة", 7102);
            }
        } catch (GsAuthException e) {
            NotifyPlugin.show(ctx, NotifyPlugin.CH_MEALS, "حجز الوجبات",
                "تعذر حجز الوجبة — سجل الدخول في التطبيق أولاً", 7102);
        } catch (Exception e) {
            failReason = shortMsg(e.getMessage());
            String body = "تعذر حجز الوجبة";
            if (failReason != null && !failReason.isEmpty()) body += " — " + failReason;
            NotifyPlugin.show(ctx, NotifyPlugin.CH_MEALS, "حجز الوجبات", body, 7102);
        }

        // Daily rollover (setExact does not repeat; same ID => no duplicates).
        NotifyPlugin.rescheduleIfEnabled(ctx);
    }

    /** Progres/guest auth failure: the fix is a fresh app login. */
    static class GsAuthException extends Exception {
        GsAuthException(String m) { super(m); }
    }

    /** Direct ministry chain: webetu wilaya+residence, gs login (HMAC),
     *  reservemeal, verify against the reservations list. */
    static class GsChain {
        final String uuid, dia, token;
        final SharedPreferences p;
        Object wilaya, residence;
        String gs;

        GsChain(String uuid, String dia, String token, SharedPreferences p) throws Exception {
            this.uuid = uuid; this.dia = dia; this.token = token; this.p = p;
            this.wilaya = numOrStr(resolveWilaya());
            this.residence = numOrStr(resolveResidence());
            this.gs = cachedGs();
            if (this.gs == null) this.gs = loginFresh();
        }

        Object wilayaJson() { return wilaya; }
        Object residenceJson() { return residence; }

        String gs() { return gs; }

        private String resolveWilaya() throws Exception {
            String url = WEBETU + "/wilayaInscription/" + enc(dia);
            HttpResp r = get(url, token);
            if (r.code == 401) throw new GsAuthException("progres expired");
            if (r.code != 200) throw new Exception("wilaya status-" + r.code);
            String t = r.body.trim();
            try {
                if (t.startsWith("[")) {
                    JSONArray a = new JSONArray(t);
                    if (a.length() == 0) throw new Exception("empty");
                    return pickWilaya(a.get(0));
                }
                JSONObject o = new JSONObject(t);
                return pickWilaya(o);
            } catch (GsAuthException e) { throw e; }
            catch (Exception e) {
                if (t.startsWith("\"") && t.endsWith("\"")) return t.substring(1, t.length() - 1);
                if (!t.isEmpty() && !t.startsWith("{") && !t.startsWith("[")) return t;
                throw new Exception("bad wilaya");
            }
        }

        private String pickWilaya(Object o) throws Exception {
            if (o instanceof JSONObject) {
                JSONObject j = (JSONObject) o;
                for (String k : new String[]{"idWilaya", "wilaya", "idWillaya", "codeWilaya", "code", "id"}) {
                    if (j.has(k) && !j.isNull(k)) return String.valueOf(j.get(k));
                }
                throw new Exception("bad wilaya");
            }
            return String.valueOf(o);
        }

        private String resolveResidence() throws Exception {
            String url = WEBETU + "/bac/" + enc(uuid) + "/demandesHebregement";
            HttpResp r = get(url, token);
            if (r.code == 401) throw new GsAuthException("progres expired");
            if (r.code != 200) throw new Exception("residence status-" + r.code);
            JSONArray a = new JSONArray(r.body.trim());
            String year = String.valueOf(Calendar.getInstance().get(Calendar.YEAR));
            JSONObject picked = null;
            for (int i = 0; i < a.length(); i++) {
                JSONObject it = a.optJSONObject(i);
                if (it == null) continue;
                if (String.valueOf(it.opt("idAnneeAcademique")).contains(year)) { picked = it; break; }
            }
            if (picked == null) picked = a.optJSONObject(0);
            if (picked == null || !picked.has("idResidance")) throw new Exception("no residence");
            return String.valueOf(picked.get("idResidance"));
        }

        private String cachedGs() {
            String t = p.getString("gsToken", "");
            long ts = p.getLong("gsTs", 0);
            if (!t.isEmpty() && System.currentTimeMillis() - ts < GS_TTL_MS) return t;
            return null;
        }

        private String loginFresh() throws Exception {
            JSONObject body = new JSONObject();
            body.put("uuid", uuid);
            body.put("wilaya", wilaya);
            body.put("residence", residence);
            body.put("token", token);
            HttpResp r = postSigned(GS + "/api/loginpwebetu", body.toString(), null);
            if (r.code == 401 || r.code == 403) throw new GsAuthException("gs login refused");
            if (r.code != 200) throw new Exception("gs login status-" + r.code);
            String t = new JSONObject(r.body).optString("token", "");
            if (t.isEmpty()) throw new Exception("gs login empty");
            p.edit().putString("gsToken", t).putLong("gsTs", System.currentTimeMillis()).apply();
            return t;
        }

        void post(String path, JSONObject body) throws Exception {
            HttpResp r = postSigned(GS + path, body.toString(), gs);
            if (r.code == 401 || r.code == 403) {
                p.edit().remove("gsToken").remove("gsTs").apply();
                gs = loginFresh();
                body.put("token", gs);
                r = postSigned(GS + path, body.toString(), gs);
            }
            if (r.code < 200 || r.code >= 300) throw new Exception("status-" + r.code);
        }

        int countForDate(String date, List<Integer> meals) throws Exception {
            String qs = "uuid=" + enc(uuid) + "&wilaya=" + enc(String.valueOf(wilaya))
                + "&residence=" + enc(String.valueOf(residence)) + "&token=" + enc(gs) + "&page=1";
            HttpResp r = getSigned(GS + "/api/meal-reservations/student?" + qs, gs);
            if (r.code == 401 || r.code == 403) {
                p.edit().remove("gsToken").remove("gsTs").apply();
                gs = loginFresh();
                qs = "uuid=" + enc(uuid) + "&wilaya=" + enc(String.valueOf(wilaya))
                    + "&residence=" + enc(String.valueOf(residence)) + "&token=" + enc(gs) + "&page=1";
                r = getSigned(GS + "/api/meal-reservations/student?" + qs, gs);
            }
            if (r.code != 200) throw new Exception("verify status-" + r.code);
            return countMatches(r.body, date);
        }
    }

    private static Object numOrStr(String s) {
        try { return Long.parseLong(s.trim()); }
        catch (Exception e) { return s; }
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

    private static int countMatches(String json, String date) {
        try {
            JSONArray arr;
            String t = json.trim();
            if (t.startsWith("[")) {
                arr = new JSONArray(t);
            } else {
                JSONObject o = new JSONObject(t);
                if (o.has("data")) {
                    Object inner = o.get("data");
                    if (inner instanceof JSONArray) arr = (JSONArray) inner;
                    else if (inner instanceof JSONObject && ((JSONObject) inner).has("data")) {
                        arr = ((JSONObject) inner).optJSONArray("data");
                        if (arr == null) return 0;
                    } else return 0;
                } else return 0;
            }
            int n = 0;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject r = arr.optJSONObject(i);
                if (r == null) continue;
                String d = r.optString("date_reserve", "");
                if (d.length() >= 10) d = d.substring(0, 10);
                if (d.equals(date)) n++;
            }
            return n;
        } catch (Exception e) {
            return 0;
        }
    }

    /** Raw response holder (no exceptions on HTTP error status). */
    static class HttpResp {
        final int code;
        final String body;
        HttpResp(int code, String body) { this.code = code; this.body = body; }
    }

    private static String hmacHex(String msg) throws Exception {
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(GS_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] sig = mac.doFinal(msg.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder(sig.length * 2);
        for (byte b : sig) sb.append(String.format(Locale.US, "%02x", b & 0xff));
        return sb.toString();
    }

    private static String nonce32() {
        return java.util.UUID.randomUUID().toString().replace("-", "");
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(25000);
        c.setReadTimeout(45000);
        return c;
    }

    private static void signHeaders(HttpURLConnection c, String bodyStr, String gsToken) throws Exception {
        String ts = String.valueOf(System.currentTimeMillis() / 1000L);
        String nonce = nonce32();
        c.setRequestProperty("X-Timestamp", ts);
        c.setRequestProperty("X-Nonce", nonce);
        c.setRequestProperty("X-Signature", hmacHex(ts + "|" + nonce + "|" + bodyStr));
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36");
        c.setRequestProperty("Accept", "application/json");
        if (gsToken != null && !gsToken.isEmpty()) c.setRequestProperty("authorization", "Bearer " + gsToken);
    }

    private static String drain(HttpURLConnection c, int code) throws Exception {
        java.io.InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
        return readAll(in);
    }

    private static HttpResp get(String url, String progresToken) throws Exception {
        HttpURLConnection c = open(url);
        try {
            c.setRequestMethod("GET");
            c.setRequestProperty("authorization", progresToken);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36");
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            return new HttpResp(code, drain(c, code));
        } finally {
            c.disconnect();
        }
    }

    private static HttpResp postSigned(String url, String bodyStr, String gsToken) throws Exception {
        HttpURLConnection c = open(url);
        try {
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            signHeaders(c, bodyStr, gsToken);
            try (OutputStream os = c.getOutputStream()) {
                os.write(bodyStr.getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            return new HttpResp(code, drain(c, code));
        } finally {
            c.disconnect();
        }
    }

    private static HttpResp getSigned(String url, String gsToken) throws Exception {
        HttpURLConnection c = open(url);
        try {
            c.setRequestMethod("GET");
            signHeaders(c, "", gsToken);
            int code = c.getResponseCode();
            return new HttpResp(code, drain(c, code));
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
