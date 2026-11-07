package com.cardipaw.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.os.Bundle;
import android.util.Base64;
import androidx.annotation.Nullable;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Long-press shortcuts that open a pet's tracker (src/native/shortcuts.ts). Never
 * pushDynamicShortcut, reportShortcutUsed or setLongLived: they reach Google and conversation
 * surfaces.
 */
@CapacitorPlugin(name = "LauncherShortcuts")
public class LauncherShortcutsPlugin extends Plugin {

    static final String ACTION_MEASURE_PET = "com.cardipaw.app.action.MEASURE_PET";
    static final String EXTRA_PET_ID = "com.cardipaw.app.extra.PET_ID";
    private static final String TAG = "LauncherShortcuts";
    // Our shortcuts only, so other kinds can be added later.
    private static final String ID_PREFIX = "measure:";
    // Android allows 15 on API 37; four keep the long-press menu short.
    private static final int MAX_DYNAMIC = 4;
    // 108dp at xxxhdpi: the adaptive icon's full canvas.
    private static final int ICON_PX = 432;
    // Its 72dp safe zone: a circular mask still shows the whole photo, like the in-app avatar.
    private static final int PHOTO_PX = 288;
    private static final long MAX_DECODED_PIXELS = 4_000_000L;

    /** Drops the pet id from a shortcut's intent that was already handled. Reads no extras. */
    static void forgetShortcut(@Nullable Intent intent) {
        if (intent != null && ACTION_MEASURE_PET.equals(intent.getAction())) {
            intent.replaceExtras((Bundle) null);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        // Normal launches and other plugins' intents.
        if (!ACTION_MEASURE_PET.equals(intent.getAction())) return;
        String petId;
        try {
            petId = intent.getStringExtra(EXTRA_PET_ID);
        } catch (RuntimeException e) {
            // MainActivity is exported: another app can send a parcel that doesn't unparcel.
            Logger.warn(TAG, "Unreadable shortcut intent: " + e);
            return;
        }
        if (petId == null || petId.isEmpty()) return;
        JSObject data = new JSObject();
        data.put("petId", petId);
        // Kept until the page adds its listener: on a cold start this runs before the page loads.
        notifyListeners("shortcutOpened", data, true);
    }

    /**
     * {pets: [{id, shortLabel, longLabel, photo}], disabledMessage, deletedLabel}: every pet in
     * the app's order. The first four become the long-press shortcuts; pins of other pets are
     * updated, pins of pets that came back are enabled, and pins of pets that are gone get
     * deletedLabel and the app icon, then are disabled.
     */
    // No usage reporting (see the class comment): the shortcuts keep the home screen's order.
    @SuppressLint("ReportShortcutUsage")
    @PluginMethod
    public void setShortcuts(PluginCall call) {
        Context ctx = getContext();
        try {
            JSArray pets = call.getArray("pets");
            String disabledMessage = call.getString("disabledMessage");
            String deletedLabel = call.getString("deletedLabel");
            if (pets == null || disabledMessage == null || disabledMessage.isEmpty()
                    || deletedLabel == null || deletedLabel.isEmpty()) {
                call.reject("pets, disabledMessage and deletedLabel are required", "INVALID");
                return;
            }
            // Keeps the app's order.
            Map<String, JSONObject> byId = new LinkedHashMap<>();
            for (int i = 0; i < pets.length(); i++) {
                JSONObject pet = pets.getJSONObject(i);
                byId.put(ID_PREFIX + pet.getString("id"), pet);
            }
            int max = Math.min(MAX_DYNAMIC, ShortcutManagerCompat.getMaxShortcutCountPerActivity(ctx));
            List<ShortcutInfoCompat> top = new ArrayList<>();
            Set<String> topIds = new HashSet<>();
            for (Map.Entry<String, JSONObject> e : byId.entrySet()) {
                if (top.size() == max) break;
                top.add(build(ctx, e.getKey(), e.getValue(), top.size()));
                topIds.add(e.getKey());
            }
            List<ShortcutInfoCompat> toUpdate = new ArrayList<>();
            List<ShortcutInfoCompat> toEnable = new ArrayList<>();
            List<String> toDisable = new ArrayList<>();
            for (ShortcutInfoCompat pin : ShortcutManagerCompat.getShortcuts(ctx, ShortcutManagerCompat.FLAG_MATCH_PINNED)) {
                String id = pin.getId();
                // A top pet's pin: setDynamicShortcuts below updates it, and enables it again.
                if (!id.startsWith(ID_PREFIX) || topIds.contains(id)) continue;
                JSONObject pet = byId.get(id);
                if (pet == null) {
                    // Android keeps a disabled pin's label and icon: the pet's name and photo
                    // would stay on the home screen. Updating a disabled pin keeps it disabled.
                    toUpdate.add(build(ctx, id, deletedLabel, deletedLabel, null, 0));
                    toDisable.add(id);
                    continue;
                }
                ShortcutInfoCompat info = build(ctx, id, pet, 0);
                toUpdate.add(info);
                // A pet an import brought back.
                if (!pin.isEnabled()) toEnable.add(info);
            }
            // false: rate-limited (only in the background). JS tries again on the next resume.
            if (!ShortcutManagerCompat.setDynamicShortcuts(ctx, top)) {
                call.reject("Rate-limited", "RATE_LIMITED");
                return;
            }
            if (!toEnable.isEmpty()) ShortcutManagerCompat.enableShortcuts(ctx, toEnable);
            if (!toUpdate.isEmpty() && !ShortcutManagerCompat.updateShortcuts(ctx, toUpdate)) {
                call.reject("Rate-limited", "RATE_LIMITED");
                return;
            }
            // On every sync: updating and disabling again replace the label and the message, so they
            // follow the app's language.
            if (!toDisable.isEmpty()) ShortcutManagerCompat.disableShortcuts(ctx, toDisable, disabledMessage);
            call.resolve();
        } catch (JSONException | RuntimeException e) {
            // RuntimeException: e.g. IllegalStateException while the phone's user is still locked.
            call.reject(String.valueOf(e.getMessage()), "FAILED");
        }
    }

    private ShortcutInfoCompat build(Context ctx, String id, JSONObject pet, int rank) throws JSONException {
        // isNull, not optString: Android's optString turns a JSON null into the text "null".
        String photo = pet.isNull("photo") ? null : pet.getString("photo");
        return build(ctx, id, pet.getString("shortLabel"), pet.getString("longLabel"), photo, rank);
    }

    /** photo: a data URL, or null for the app icon. */
    private ShortcutInfoCompat build(
        Context ctx,
        String id,
        String shortLabel,
        String longLabel,
        @Nullable String photo,
        int rank
    ) {
        Intent intent = new Intent(ACTION_MEASURE_PET)
            .setClass(ctx, MainActivity.class)
            .putExtra(EXTRA_PET_ID, id.substring(ID_PREFIX.length()));
        return new ShortcutInfoCompat.Builder(ctx, id)
            .setShortLabel(shortLabel)
            .setLongLabel(longLabel)
            .setIcon(icon(ctx, photo))
            .setIntent(intent)
            .setRank(rank)
            .build();
    }

    private static IconCompat icon(Context ctx, @Nullable String dataUrl) {
        if (dataUrl != null) {
            try {
                Bitmap bitmap = squareIcon(ctx, dataUrl);
                if (bitmap != null) return IconCompat.createWithAdaptiveBitmap(bitmap);
            } catch (Throwable t) {
                // OutOfMemoryError too: a photo must never break the sync.
                Logger.warn(TAG, "Pet photo unusable as an icon: " + t);
            }
        }
        return IconCompat.createWithResource(ctx, R.mipmap.ic_launcher);
    }

    /** The photo's centre square on the app background, inside the safe zone. Null if unusable. */
    @Nullable
    private static Bitmap squareIcon(Context ctx, String dataUrl) {
        byte[] bytes = Base64.decode(dataUrl.substring(dataUrl.indexOf(',') + 1), Base64.DEFAULT);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (options.outWidth <= 0 || options.outHeight <= 0) return null;
        int sample = 1;
        while (Math.min(options.outWidth, options.outHeight) / (sample * 2) >= PHOTO_PX) sample *= 2;
        // A long, thin image is still big after sampling by its short side.
        if ((long) (options.outWidth / sample) * (options.outHeight / sample) > MAX_DECODED_PIXELS) return null;
        options.inJustDecodeBounds = false;
        options.inSampleSize = sample;
        Bitmap src = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (src == null) return null;
        int side = Math.min(src.getWidth(), src.getHeight());
        int x = (src.getWidth() - side) / 2;
        int y = (src.getHeight() - side) / 2;
        Bitmap out = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        // The theme's background at sync time; a circular mask hides it.
        canvas.drawColor(ctx.getColor(R.color.app_background));
        int pad = (ICON_PX - PHOTO_PX) / 2;
        canvas.drawBitmap(
            src,
            new Rect(x, y, x + side, y + side),
            new Rect(pad, pad, pad + PHOTO_PX, pad + PHOTO_PX),
            new Paint(Paint.FILTER_BITMAP_FLAG)
        );
        src.recycle();
        return out;
    }
}
