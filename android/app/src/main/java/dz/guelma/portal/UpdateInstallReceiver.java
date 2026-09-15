package dz.guelma.portal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

import com.getcapacitor.JSObject;

/** Receives PackageInstaller session outcomes and forwards them to JS.
 *  On success the system replaces the app; relaunch with a clean intent
 *  so the user returns to the updated application with data intact.
 *  Nothing is swallowed: every branch is reported (log + JS event). */
public class UpdateInstallReceiver extends BroadcastReceiver {

    private static final String TAG = "PortalUpdate";

    private static String errText(Exception e) {
        try {
            String m = e.getClass().getSimpleName();
            String d = e.getMessage();
            return (d == null || d.isEmpty()) ? m : (m + ": " + d);
        } catch (Exception ignored) {
            return "unknown";
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        try {
            Context ctx = context.getApplicationContext();
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS,
                PackageInstaller.STATUS_FAILURE);
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            int legacy = intent.getIntExtra("android.content.pm.extra.LEGACY_STATUS", Integer.MIN_VALUE);
            String pkg = intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME);
            String other = intent.getStringExtra(PackageInstaller.EXTRA_OTHER_PACKAGE_NAME);
            int sess = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1);
            android.util.Log.i(TAG, "install status=" + status + " legacy=" + legacy
                + " pkg=" + pkg + " other=" + other + " session=" + sess + " msg=" + msg);
            switch (status) {
                case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                    Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm == null) {
                        android.util.Log.w(TAG, "pending_user_action without confirm intent");
                        JSObject r0 = new JSObject();
                        r0.put("phase", "failed");
                        r0.put("message", "system gave no confirmation screen");
                        UpdatePlugin.emit("installStatus", r0);
                        break;
                    }
                    try {
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        ctx.startActivity(confirm);
                    } catch (Exception e) {
                        android.util.Log.w(TAG, "confirm start blocked: " + errText(e));
                        JSObject r0 = new JSObject();
                        r0.put("phase", "failed");
                        r0.put("message", "confirm blocked: " + errText(e));
                        UpdatePlugin.emit("installStatus", r0);
                        break;
                    }
                    JSObject r = new JSObject();
                    r.put("phase", "confirming");
                    UpdatePlugin.emit("installStatus", r);
                    break;
                }
                case PackageInstaller.STATUS_SUCCESS: {
                    JSObject r = new JSObject();
                    r.put("phase", "success");
                    UpdatePlugin.emit("installStatus", r);
                    try {
                        Intent launch = ctx.getPackageManager()
                            .getLaunchIntentForPackage(ctx.getPackageName());
                        if (launch != null) {
                            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                            ctx.startActivity(launch);
                        }
                    } catch (Exception e) {
                        android.util.Log.w(TAG, "relaunch failed: " + errText(e));
                    }
                    break;
                }
                case PackageInstaller.STATUS_FAILURE_ABORTED: {
                    JSObject r = new JSObject();
                    r.put("phase", "cancelled");
                    UpdatePlugin.emit("installStatus", r);
                    break;
                }
                default: {
                    JSObject r = new JSObject();
                    r.put("phase", "failed");
                    StringBuilder sb = new StringBuilder();
                    sb.append("system status=").append(status);
                    if (legacy != Integer.MIN_VALUE) sb.append(" legacy=").append(legacy);
                    if (msg != null && !msg.isEmpty()) sb.append(": ").append(msg);
                    if (pkg != null && !pkg.isEmpty()) sb.append(" pkg=").append(pkg);
                    if (other != null && !other.isEmpty()) sb.append(" other=").append(other);
                    r.put("message", sb.toString());
                    UpdatePlugin.emit("installStatus", r);
                    break;
                }
            }
        } catch (Exception e) {
            android.util.Log.w(TAG, "receiver error: " + errText(e));
        }
    }
}
