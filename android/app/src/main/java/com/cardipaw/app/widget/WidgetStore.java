package com.cardipaw.app.widget;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONException;

/** The snapshot and each single-pet widget's pet id. Backups exclude all SharedPreferences. */
public final class WidgetStore {

    private static final String TAG = "CardiPawWidget";
    static final String PREFS = "cardipaw_widget";
    static final String KEY_SNAPSHOT = "snapshot";
    private static final String KEY_PET = "pet_";

    private WidgetStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** commit(), not apply(): the plugin resolves only once the snapshot is on disk. */
    static boolean writeSnapshot(Context ctx, String json) {
        return prefs(ctx).edit().putString(KEY_SNAPSHOT, json).commit();
    }

    /** null when the app hasn't sent one yet (or it can't be read): the widget says "Open CardiPaw". */
    static WidgetSnapshot readSnapshot(Context ctx) {
        String json = prefs(ctx).getString(KEY_SNAPSHOT, null);
        if (json == null) return null;
        try {
            return WidgetSnapshot.parse(json);
        } catch (JSONException e) {
            Log.w(TAG, "Unreadable widget snapshot", e);
            return null;
        }
    }

    static String petId(Context ctx, int widgetId) {
        return prefs(ctx).getString(KEY_PET + widgetId, null);
    }

    /** apply() updates the in-memory copy at once, so a redraw right after reads the new id. */
    static void setPetId(Context ctx, int widgetId, String petId) {
        prefs(ctx).edit().putString(KEY_PET + widgetId, petId).apply();
    }

    static void forget(Context ctx, int[] widgetIds) {
        SharedPreferences.Editor e = prefs(ctx).edit();
        for (int id : widgetIds) e.remove(KEY_PET + id);
        e.apply();
    }
}
