package com.cardipaw.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/** Opens the system settings where the user turns CardiPaw's notifications back on. */
@CapacitorPlugin(name = "NotificationSettings")
public class NotificationSettingsPlugin extends Plugin {

    /** CardiPaw's notification settings (API 26+), else its app info screen (minSdk 24). */
    @PluginMethod
    public void open(PluginCall call) {
        String pkg = getContext().getPackageName();
        List<Intent> screens = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            screens.add(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg));
        }
        screens.add(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null)));
        for (Intent screen : screens) {
            try {
                getActivity().startActivity(screen);
                call.resolve();
                return;
            } catch (ActivityNotFoundException e) {
                // Some vendors leave out a settings screen: try the next one.
            }
        }
        call.reject("No settings screen to open", "UNAVAILABLE");
    }
}
