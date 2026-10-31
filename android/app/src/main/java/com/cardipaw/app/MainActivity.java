package com.cardipaw.app;

import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Until the page paints, the app background shows instead of white (app_background has
        // a values-night variant). AppCompat gave the window the launch theme's background in
        // super.onCreate, before BridgeActivity switched to AppTheme.NoActionBar, so the window
        // gets it here. Capacitor colours the WebView only from capacitor.config's
        // backgroundColor, which can't follow dark mode.
        int background = getColor(R.color.app_background);
        getWindow().setBackgroundDrawable(new ColorDrawable(background));
        // getBridge() is null when the device has no WebView: BridgeActivity then shows its own
        // no_webview screen.
        if (getBridge() != null) {
            getBridge().getWebView().setBackgroundColor(background);
        }
    }
}
