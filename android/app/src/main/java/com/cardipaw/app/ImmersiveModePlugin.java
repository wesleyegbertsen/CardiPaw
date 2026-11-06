package com.cardipaw.app;

import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hides the system bars while the camera count fills the screen in landscape. The web
 * Fullscreen API can't: Capacitor's BridgeWebChromeClient closes a fullscreen view at once.
 * Not named "SystemBars": that is Capacitor's own plugin, which a second one would replace.
 */
@CapacitorPlugin(name = "ImmersiveMode")
public class ImmersiveModePlugin extends Plugin {

    /**
     * Status and navigation bars hidden. A swipe from the edge shows them over the page for a
     * moment instead of bringing them back for good (or, before Android 12, on any touch), so
     * the page keeps its size while the camera counts.
     */
    @PluginMethod
    public void enter(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            WindowInsetsControllerCompat controller = controller();
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
            call.resolve();
        });
    }

    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            controller().show(WindowInsetsCompat.Type.systemBars());
            call.resolve();
        });
    }

    private WindowInsetsControllerCompat controller() {
        Window window = getActivity().getWindow();
        return WindowCompat.getInsetsController(window, window.getDecorView());
    }
}
