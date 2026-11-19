package dz.guelma.portal;

import android.app.Activity;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Tiny bridge: the web splash's existing dismiss signal hides the native layer. */
@CapacitorPlugin(name = "NativeSplash")
public class NativeSplashPlugin extends Plugin {

    @PluginMethod
    public void hide(PluginCall call) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(new Runnable() {
                @Override public void run() {
                    PortalSplashView.hideActive();
                }
            });
        }
        call.resolve();
    }
}
