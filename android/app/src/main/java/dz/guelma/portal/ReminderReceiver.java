package dz.guelma.portal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Generic one-shot reminder: shows the title/body, then untracks the id. */
public class ReminderReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        try {
            Context ctx = context.getApplicationContext();
            String id = intent.getStringExtra("rid");
            String tag = intent.getStringExtra("tag");
            String title = intent.getStringExtra("title");
            String body = intent.getStringExtra("body");
            String channel = intent.getStringExtra("channel");
            if (title == null) title = "";
            if (body == null) body = "";
            if (channel == null || channel.isEmpty()) channel = NotifyPlugin.CH_GENERAL;
            if (tag == null) tag = "general";
            if (id != null) NotifyPlugin.untrackReminder(ctx, tag, id);
            if (!body.isEmpty()) {
                NotifyPlugin.show(ctx, channel, title, body, id != null ? id.hashCode() : (int) System.currentTimeMillis());
            }
        } catch (Exception ignored) {}
    }
}
