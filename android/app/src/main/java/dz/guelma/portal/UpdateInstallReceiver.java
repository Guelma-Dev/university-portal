package dz.guelma.portal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

import com.getcapacitor.JSObject;

/** Receives PackageInstaller session outcomes and forwards them to JS.
 *  On success the system replaces the app; relaunch with a clean intent
 *  so the user returns to the updated application with data intact. */
public class UpdateInstallReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        try {
            Context ctx = context.getApplicationContext();
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS,
                PackageInstaller.STATUS_FAILURE);
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            switch (status) {
                case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                    Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) {
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        ctx.startActivity(confirm);
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
                    } catch (Exception ignored) {}
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
                    r.put("message", msg != null ? msg : "");
                    UpdatePlugin.emit("installStatus", r);
                    break;
                }
            }
        } catch (Exception ignored) {}
    }
}
