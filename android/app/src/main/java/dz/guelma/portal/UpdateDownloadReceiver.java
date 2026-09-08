package dz.guelma.portal;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.getcapacitor.JSObject;

/** Forwards system download completion to the JS update layer. */
public class UpdateDownloadReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
        try {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            JSObject r = new JSObject();
            r.put("downloadId", id);
            UpdatePlugin.emit("downloadComplete", r);
        } catch (Exception ignored) {}
    }
}
