package com.cardipaw.app.widget;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;

/** src/native/homeWidget.ts: stores the snapshot the page built. */
@CapacitorPlugin(name = "HomeWidget")
public class HomeWidgetPlugin extends Plugin {

    @PluginMethod
    public void setSnapshot(PluginCall call) {
        String json = call.getString("json");
        try {
            WidgetSnapshot.parse(json);
        } catch (JSONException e) {
            // Keep the previous snapshot: a bad one would only show "Open CardiPaw".
            call.reject("Invalid widget snapshot: " + e.getMessage(), "INVALID");
            return;
        }
        if (!WidgetStore.writeSnapshot(getContext(), json)) {
            call.reject("Could not store the widget snapshot");
            return;
        }
        call.resolve();
    }
}
