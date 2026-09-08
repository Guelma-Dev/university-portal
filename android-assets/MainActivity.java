package dz.guelma.portal;

import android.graphics.Color;
import android.os.Bundle;
import android.webkit.ValueCallback;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private boolean backQueued = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MinistryHttpPlugin.class);
        registerPlugin(NotifyPlugin.class);
        super.onCreate(savedInstanceState);
        // Edge-to-edge: app content flows under the system bars so the
        // status bar blends seamlessly into the app background (insets
        // are handled in CSS via safe-area / --sat). No divider strip.
        try {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        } catch (Exception ignored) {}
    }

    @Override
    public void onResume() {
        super.onResume();
        // Re-assert after bridge init / background return so no opaque
        // system strip can reappear above the app content.
        try {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        } catch (Exception ignored) {}
    }

    @Override
    public void onBackPressed() {
        if (backQueued) return;
        if (getBridge() == null || getBridge().getWebView() == null) {
            super.onBackPressed();
            return;
        }
        backQueued = true;
        getBridge().getWebView().evaluateJavascript(
            "(function(){try{return window.portalBackButton?window.portalBackButton():false;}catch(e){return false;}})()",
            new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    backQueued = false;
                    if ("true".equals(value)) {
                        return;
                    }
                    finish();
                }
            });
    }
}