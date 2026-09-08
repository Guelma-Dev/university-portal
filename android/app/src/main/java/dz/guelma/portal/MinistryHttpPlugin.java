package dz.guelma.portal;

import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Native OkHttp bridge used ONLY for hosts that serve certificates which do
 * NOT chain to any system trust anchor (expired + unknown/self-signed CA),
 * which Android reports as "Trust anchor for certification path not found".
 * Currently scoped to:
 *   1. gs-api.onou.dz   (the meals service)
 *   2. elearning.univ-guelma.dz (the Moodle e-learning platform; the server
 *      currently serves an expired certificate)
 * Everything else on the device keeps a fully closed strict-TLS trust chain.
 *
 * The JS layer (js/native.js) sends every other ministry request through the
 * normal CapacitorHttp stack, which keeps strict TLS everywhere else.
 */
@CapacitorPlugin(name = "MinistryHttp")
public class MinistryHttpPlugin extends Plugin {

    private static final String[] ALLOW_HOSTS = {"gs-api.onou.dz", "elearning.univ-guelma.dz"};

    private static boolean allowedHost(String url) {
        for (String host : ALLOW_HOSTS) {
            if (url != null && url.startsWith("https://" + host)) {
                return true;
            }
        }
        return false;
    }
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final String TAG = "MinistryHttp";

    private OkHttpClient client;

    private OkHttpClient client() {
        if (client == null) {
            synchronized (this) {
                if (client == null) {
                    client = buildClient();
                }
            }
        }
        return client;
    }

    private OkHttpClient buildClient() {
        try {
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init((java.security.KeyStore) null);
            for (TrustManager tm : tmf.getTrustManagers()) {
                if (!(tm instanceof X509TrustManager)) {
                    continue;
                }
                X509TrustManager deleg = (X509TrustManager) tm;
                X509TrustManager relaxed = new X509TrustManager() {
                    @Override
                    public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                        deleg.checkClientTrusted(chain, authType);
                    }

                    @Override
                    public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                        try {
                            deleg.checkServerTrusted(chain, authType);
                        } catch (CertificateException e) {
                            // Scoped, deliberate: the ministry server currently serves a
                            // certificate whose chain does NOT resolve to any system trust
                            // anchor (expired + unknown/self-signed CA) — the exact failure
                            // reported on-device as
                            // "Trust anchor for certification path not found".
                            // This client is used ONLY for gs-api.onou.dz (enforced by the
                            // URL prefix check below AND the hostname verifier), so the
                            // weakened anchor check never escapes to other hosts.
                        }
                    }

                    @Override
                    public X509Certificate[] getAcceptedIssuers() {
                        return deleg.getAcceptedIssuers();
                    }
                };
SSLContext sc = SSLContext.getInstance("TLS");
                        sc.init(null, new TrustManager[]{relaxed}, new SecureRandom());
                        return new OkHttpClient.Builder()
                        .sslSocketFactory(sc.getSocketFactory(), relaxed)
                        .hostnameVerifier((hostname, session) -> {
                            for (String host : ALLOW_HOSTS) {
                                if (host.equals(hostname)) {
                                    return true;
                                }
                            }
                            return false;
                        })
                        .connectTimeout(20, TimeUnit.SECONDS)
                        .readTimeout(45, TimeUnit.SECONDS)
                        .build();
            }
        } catch (Exception e) {
            Log.e(TAG, "buildClient failed: " + e.getMessage());
        }
        return new OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(45, TimeUnit.SECONDS)
                .build();
    }

    @PluginMethod
    public void relaxed(PluginCall call) {
        String method = call.getString("method", "GET").toUpperCase();
        String url = call.getString("url", "");
        JSObject headersObj = call.getObject("headers");
        String body = call.getString("body", "");

        if (url == null || !allowedHost(url)) {
            call.reject("refused: host not allowed");
            return;
        }

        Request.Builder rb = new Request.Builder().url(url);
        if (headersObj != null) {
            java.util.Iterator<String> it = headersObj.keys();
            while (it.hasNext()) {
                String key = it.next();
                Object v = headersObj.opt(key);
                if (v != null) {
                    rb.header(key, String.valueOf(v));
                }
            }
        }
        if ("POST".equals(method) || "PUT".equals(method) || "DELETE".equals(method)) {
            RequestBody reqBody = RequestBody.create(body == null ? "" : body, JSON);
            rb.method(method, reqBody);
        } else {
            rb.get();
        }

        final Request request = rb.build();
        new Thread(() -> {
            try (Response resp = client().newCall(request).execute()) {
                String respBody = resp.body() != null ? resp.body().string() : "";
                String ct = resp.header("Content-Type");
                JSObject out = new JSObject();
                out.put("status", resp.code());
                out.put("body", respBody);
                JSObject hdrs = new JSObject();
                if (ct != null) {
                    hdrs.put("content-type", ct);
                }
                out.put("headers", hdrs);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("http failed: " + e.getMessage());
            }
        }).start();
    }

    /**
     * Binary GET through the relaxed-TLS client. Returns the body as base64
     * (lossless for PDFs/binaries), used by the e-learning library to open
     * and download Moodle files whose host serves an expired certificate.
     */
    @PluginMethod
    public void relaxedBytes(PluginCall call) {
        String url = call.getString("url", "");
        if (!allowedHost(url)) {
            call.reject("refused: host not allowed");
            return;
        }
        Request.Builder rb = new Request.Builder().url(url).header("Accept", "*/*");
        JSObject headersObj = call.getObject("headers");
        if (headersObj != null) {
            java.util.Iterator<String> it = headersObj.keys();
            while (it.hasNext()) {
                String key = it.next();
                Object v = headersObj.opt(key);
                if (v != null) {
                    rb.header(key, String.valueOf(v));
                }
            }
        }
        final Request request = rb.build();
        new Thread(() -> {
            try (Response resp = client().newCall(request).execute()) {
                byte[] data = resp.body() != null ? resp.body().bytes() : new byte[0];
                JSObject out = new JSObject();
                out.put("status", resp.code());
                out.put("base64", Base64.encodeToString(data, Base64.NO_WRAP));
                out.put("contentType", resp.header("Content-Type", ""));
                call.resolve(out);
            } catch (Exception e) {
                call.reject("http failed: " + e.getMessage());
            }
        }).start();
    }

    private static String sanitizeFileName(String name) {
        String clean = name == null ? "file" : name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (clean.isEmpty() || clean.equalsIgnoreCase(".") || clean.equalsIgnoreCase("..")) {
            clean = "file";
        }
        if (clean.length() > 120) {
            clean = clean.substring(clean.length() - 120);
        }
        return clean;
    }

    /**
     * Save a file (base64 payload) into the device Downloads folder.
     * API >= 29 uses the MediaStore Download collection (no permission needed,
     * visible next to the user's other downloads). Older versions fall back to
     * the app's own external Download directory.
     */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = sanitizeFileName(call.getString("name", "file"));
        String mime = call.getString("mime", "application/octet-stream");
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) {
            call.reject("no-data");
            return;
        }
        try {
            byte[] data = Base64.decode(base64.replaceAll("\\s", ""), Base64.NO_WRAP);
            String path = writeToDownloads(name, mime, data);
            JSObject out = new JSObject();
            out.put("status", "ok");
            out.put("path", path);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }

    private String writeToDownloads(String name, String mime, byte[] data) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PortalGuelma");
            cv.put("is_public", 1);
            Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri != null) {
                OutputStream os = getContext().getContentResolver().openOutputStream(uri);
                os.write(data);
                os.flush();
                os.close();
                return "Download/PortalGuelma/" + name;
            }
        }
        File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "PortalGuelma");
        if (dir == null) {
            dir = new File(getContext().getFilesDir(), "PortalGuelma");
        }
        dir.mkdirs();
        File f = new File(dir, name);
        FileOutputStream fos = new FileOutputStream(f);
        fos.write(data);
        fos.flush();
        fos.close();
        return f.getAbsolutePath();
    }

    /**
     * Open a file with the system viewer (ACTION_VIEW through FileProvider).
     * Used by the e-learning library to display PDFs and other resources, which
     * a plain WebView iframe cannot render.
     */
    @PluginMethod
    public void viewFile(PluginCall call) {
        String name = sanitizeFileName(call.getString("name", "file"));
        String mime = call.getString("mime", "application/octet-stream");
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) {
            call.reject("no-data");
            return;
        }
        try {
            byte[] data = Base64.decode(base64.replaceAll("\\s", ""), Base64.NO_WRAP);
            File dir = new File(getContext().getCacheDir(), "portal_lib");
            dir.mkdirs();
            File f = new File(dir, name);
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(data);
            fos.flush();
            fos.close();
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                getContext().startActivity(intent);
                call.resolve();
            } catch (ActivityNotFoundException e) {
                call.reject("no-viewer");
            }
        } catch (Exception e) {
            call.reject("view failed: " + e.getMessage());
        }
    }

    /**
     * Open an external URL with the system browser. Used to let a user finish
     * a one-click self-enrolment on Moodle's own site ("Auto-inscription")
     * when a library course is not in their enrolments yet; after that the
     * same token can fetch the course files in-app.
     */
    @PluginMethod
    public void openInBrowser(PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("no-url");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no-browser");
        } catch (Exception e) {
            call.reject("open failed: " + e.getMessage());
        }
    }
}