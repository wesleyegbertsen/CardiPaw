package com.cardipaw.app.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.text.format.DateFormat;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import com.cardipaw.app.R;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * Draws every CardiPaw widget from the stored snapshot. Colours live in the layouts (values-night):
 * a colour set from code wouldn't follow a dark mode switch until the next redraw.
 */
final class WidgetUpdater {

    /** One per status, pre-coloured; the snapshot's status picks which one shows. */
    private static final int[] BADGES = { R.id.badge_normal, R.id.badge_warning, R.id.badge_danger };

    private WidgetUpdater() {}

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] petIds = mgr.getAppWidgetIds(new ComponentName(ctx, PetWidgetProvider.class));
        int[] allPetsIds = mgr.getAppWidgetIds(new ComponentName(ctx, AllPetsWidgetProvider.class));
        for (int id : petIds) updatePet(ctx, mgr, id);
        for (int id : allPetsIds) updateAllPets(ctx, mgr, id);
        if (needsMidnight(petIds.length, allPetsIds.length)) scheduleMidnight(ctx);
        else cancelMidnight(ctx);
    }

    /** The midnight redraw is only needed while a widget is on the home screen. */
    static boolean needsMidnight(int petWidgets, int allPetsWidgets) {
        return petWidgets + allPetsWidgets > 0;
    }

    /** How many widgets of one kind are placed. */
    static int count(Context ctx, Class<?> provider) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, provider)).length;
    }

    /** Android strings in the app's language (from the snapshot) when there is one. */
    static Context localized(Context ctx, WidgetSnapshot s) {
        if (s == null) return ctx;
        Configuration c = new Configuration(ctx.getResources().getConfiguration());
        c.setLocale(Locale.forLanguageTag(s.locale));
        return ctx.createConfigurationContext(c);
    }

    static void updatePet(Context ctx, AppWidgetManager mgr, int widgetId) {
        WidgetSnapshot s = WidgetStore.readSnapshot(ctx);
        String petId = WidgetStore.petId(ctx, widgetId);
        WidgetSnapshot.Pet pet = s == null || petId == null ? null : s.find(petId);
        RemoteViews views;
        if (s == null) {
            views = message(ctx, ctx.getString(R.string.widget_open_app_first), WidgetIntents.openHome(ctx, widgetId));
        } else if (pet == null) {
            // Never picked (the picker was dismissed on a launcher that adds anyway) or deleted.
            String text = missingPetMessage(petId, localized(ctx, s).getString(R.string.widget_configure_title), s.strings.petMissing);
            views = message(ctx, text, WidgetIntents.configure(ctx, widgetId));
        } else {
            PendingIntent tap = WidgetIntents.openPet(ctx, widgetId, pet.id);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // The launcher picks the largest layout that fits the widget's current size.
                Map<SizeF, RemoteViews> sizes = new HashMap<>();
                sizes.put(new SizeF(110, 40), pet(ctx, s, pet, R.layout.widget_pet_small, tap));
                sizes.put(new SizeF(180, 100), pet(ctx, s, pet, R.layout.widget_pet, tap));
                views = new RemoteViews(sizes);
            } else {
                // MAX_HEIGHT: the portrait height on most launchers; MIN when a launcher reports none.
                Bundle o = mgr.getAppWidgetOptions(widgetId);
                int h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0));
                views = pet(ctx, s, pet, h >= 100 ? R.layout.widget_pet : R.layout.widget_pet_small, tap);
            }
        }
        mgr.updateAppWidget(widgetId, views);
    }

    /** No pet to show: none was ever picked ("Choose a pet"), or the picked one was deleted. */
    static String missingPetMessage(String petId, String chooseTitle, String petMissing) {
        return petId == null ? chooseTitle : petMissing;
    }

    /** The pet's trend alert for today in the device's time zone, or null. */
    static String alertFor(WidgetSnapshot.Pet pet, long now, TimeZone tz) {
        return pet.alerts.get(WidgetAge.dayKey(now, tz));
    }

    static RemoteViews message(Context ctx, String text, PendingIntent tap) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_message);
        v.setTextViewText(R.id.widget_message, text);
        v.setOnClickPendingIntent(R.id.widget_root, tap);
        return v;
    }

    /**
     * One pet: the single-pet layouts and the all-pets rows share these view ids (androidResources.test.ts
     * checks each layout has all of them: a missing one shows "Can't load widget"). Sets every one of
     * them, so nothing from the layout's preview text or an earlier draw shows through.
     */
    static RemoteViews pet(Context ctx, WidgetSnapshot s, WidgetSnapshot.Pet pet, int layout, PendingIntent tap) {
        long now = System.currentTimeMillis();
        TimeZone tz = TimeZone.getDefault();
        WidgetSnapshot.Strings str = s.strings;
        RemoteViews v = new RemoteViews(ctx.getPackageName(), layout);
        v.setTextViewText(R.id.initial, pet.initial);
        v.setTextViewText(R.id.name, pet.name);
        String age;
        String description;
        boolean stale = false;
        if (pet.latest == null) {
            age = str.noReadings;
            v.setViewVisibility(R.id.rate, View.GONE);
            for (int id : BADGES) v.setViewVisibility(id, View.GONE);
            // The pet's name last: user text is never scanned for placeholders.
            description = WidgetText.fill(str.a11yNoReadings, "age", age, "name", pet.name);
        } else {
            WidgetSnapshot.Latest l = pet.latest;
            // Follows the device's 12/24-hour setting.
            String time = DateFormat.getTimeFormat(localized(ctx, s)).format(new Date(l.takenAt));
            age = WidgetAge.label(str, l.takenAt, now, tz, time);
            stale = WidgetAge.isStale(l.takenAt, now, tz);
            String status = str.status.get(l.status);
            v.setViewVisibility(R.id.rate, View.VISIBLE);
            v.setTextViewText(R.id.rate, l.rate + " " + str.bpm);
            int shown = BADGES[WidgetSnapshot.STATUSES.indexOf(l.status)];
            for (int id : BADGES) {
                v.setViewVisibility(id, id == shown ? View.VISIBLE : View.GONE);
                v.setTextViewText(id, status);
            }
            description = WidgetText.fill(
                str.a11yReading, "rate", Integer.toString(l.rate), "status", status, "age", age, "name", pet.name);
        }
        // Two pre-coloured age views, for the same reason as the badges.
        v.setTextViewText(R.id.age, age);
        v.setTextViewText(R.id.age_stale, age);
        v.setViewVisibility(R.id.age, stale ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.age_stale, stale ? View.VISIBLE : View.GONE);
        String alert = alertFor(pet, now, tz);
        v.setViewVisibility(R.id.trend, alert == null ? View.GONE : View.VISIBLE);
        if (alert != null) {
            v.setTextViewText(R.id.trend, str.trend.get(alert));
            description += trendSentence(str, alert);
        }
        v.setContentDescription(R.id.widget_root, description);
        v.setOnClickPendingIntent(R.id.widget_root, tap);
        return v;
    }

    /** TalkBack's trend sentence after the reading, in the app's language (Japanese has no space). */
    static String trendSentence(WidgetSnapshot.Strings str, String alert) {
        return WidgetText.fill(str.a11yTrend, "trend", str.trend.get(alert));
    }

    /** The all-pets widget: a row per pet that fits, then "+N more" (opens the app's home). */
    static void updateAllPets(Context ctx, AppWidgetManager mgr, int widgetId) {
        WidgetSnapshot s = WidgetStore.readSnapshot(ctx);
        PendingIntent home = WidgetIntents.openHome(ctx, widgetId);
        if (s == null) {
            mgr.updateAppWidget(widgetId, message(ctx, ctx.getString(R.string.widget_open_app_first), home));
            return;
        }
        if (s.pets.isEmpty()) {
            mgr.updateAppWidget(widgetId, message(ctx, s.strings.noPets, home));
            return;
        }
        Bundle o = mgr.getAppWidgetOptions(widgetId);
        List<SizeF> sizes = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? reportedSizes(o) : Collections.<SizeF>emptyList();
        RemoteViews views;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !sizes.isEmpty()) {
            // API 31+: one per size the launcher reports (portrait, landscape), each with the rows
            // that fit it; the launcher shows the one for the current size.
            Map<SizeF, RemoteViews> bySize = new HashMap<>();
            for (SizeF size : sizes) {
                if (!bySize.containsKey(size)) bySize.put(size, allPets(ctx, s, widgetId, (int) size.getHeight(), home));
            }
            views = new RemoteViews(bySize);
        } else {
            boolean portrait = ctx.getResources().getConfiguration().orientation != Configuration.ORIENTATION_LANDSCAPE;
            int heightDp = WidgetRows.heightDp(
                o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0),
                o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0),
                portrait);
            views = allPets(ctx, s, widgetId, heightDp, home);
        }
        mgr.updateAppWidget(widgetId, views);
    }

    /** OPTION_APPWIDGET_SIZES (API 31+): the widget's size in each orientation; empty if not reported. */
    @SuppressWarnings("deprecation") // getParcelableArrayList(String, Class) is API 33+
    private static List<SizeF> reportedSizes(Bundle options) {
        List<SizeF> sizes = options.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
        return sizes == null ? Collections.<SizeF>emptyList() : sizes;
    }

    /** The pet rows that fit heightDp, then "+N more" for the rest. */
    private static RemoteViews allPets(Context ctx, WidgetSnapshot s, int widgetId, int heightDp, PendingIntent home) {
        // Rows grow with the system font size (wrap_content, minHeight 52dp).
        float fontScale = ctx.getResources().getConfiguration().fontScale;
        int petRows = WidgetRows.petRows(heightDp, s.pets.size(), fontScale);
        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.widget_all_pets);
        views.removeAllViews(R.id.rows);
        for (int i = 0; i < petRows; i++) {
            WidgetSnapshot.Pet pet = s.pets.get(i);
            // The data URI (the pet) keeps the PendingIntents apart, not the request code: it can
            // match another widget's. Two taps for the same pet may share one, and open the same.
            PendingIntent tap = WidgetIntents.openPet(ctx, widgetId * 100 + i, pet.id);
            views.addView(R.id.rows, pet(ctx, s, pet, R.layout.widget_all_pets_row, tap));
        }
        if (petRows < s.pets.size()) {
            RemoteViews more = new RemoteViews(ctx.getPackageName(), R.layout.widget_all_pets_more);
            more.setTextViewText(R.id.widget_message, s.strings.more.format(s.pets.size() - petRows));
            more.setOnClickPendingIntent(R.id.widget_root, home);
            views.addView(R.id.rows, more);
        }
        return views;
    }

    /** A non-wakeup alarm at the next local midnight: "today" becomes "yesterday" when the screen is next seen. */
    static void scheduleMidnight(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        long at = WidgetAge.nextMidnight(System.currentTimeMillis(), TimeZone.getDefault());
        // RTC (not _WAKEUP) and inexact: no SCHEDULE_EXACT_ALARM (the manifest removes it).
        am.setWindow(AlarmManager.RTC, at, 10 * 60_000L, midnightIntent(ctx));
    }

    /** No widget is left: stop the midnight alarm. */
    static void cancelMidnight(Context ctx) {
        ctx.getSystemService(AlarmManager.class).cancel(midnightIntent(ctx));
    }

    /** The same one for scheduling and cancelling: AlarmManager.cancel matches it by filterEquals. */
    private static PendingIntent midnightIntent(Context ctx) {
        Intent i = new Intent(ctx, WidgetRefreshReceiver.class).setAction(WidgetRefreshReceiver.ACTION_MIDNIGHT);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
}
