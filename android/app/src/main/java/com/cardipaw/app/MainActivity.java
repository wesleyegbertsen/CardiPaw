package com.cardipaw.app;

import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // App-local plugins are registered before super.onCreate creates the bridge.
        registerPlugin(NotificationSettingsPlugin.class);
        super.onCreate(savedInstanceState);
        // AppCompat gave the window the launch theme's background in super.onCreate, before
        // BridgeActivity switched to AppTheme.NoActionBar, so the window gets it here.
        applyBackground();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // The manifest's configChanges includes uiMode, so a dark mode switch doesn't recreate
        // the activity: its resources now hold the new app_background, applied here.
        applyBackground();
    }

    /**
     * Until the page paints, the app background shows instead of white (app_background has a
     * values-night variant). Capacitor colours the WebView only from capacitor.config's
     * backgroundColor, which can't follow dark mode.
     */
    private void applyBackground() {
        int background = getColor(R.color.app_background);
        getWindow().setBackgroundDrawable(new ColorDrawable(background));
        // getBridge() is null when the device has no WebView: BridgeActivity then shows its own
        // no_webview screen.
        if (getBridge() != null) {
            getBridge().getWebView().setBackgroundColor(background);
        }
    }
}
