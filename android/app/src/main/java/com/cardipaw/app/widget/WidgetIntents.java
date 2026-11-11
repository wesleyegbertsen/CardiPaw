package com.cardipaw.app.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import com.cardipaw.app.MainActivity;

/**
 * Taps. Each PendingIntent's Intent has its own data URI, so two never match (filterEquals) and
 * one widget's tap can't replace another's. All immutable (required from API 31).
 * FLAG_ACTIVITY_NEW_TASK isn't needed: a widget's PendingIntent starts a new task, and MainActivity
 * is singleTask, so a warm tap brings the task forward and arrives in onNewIntent.
 */
final class WidgetIntents {

    /**
     * src/utils/widgetUrl.ts parses these (WIDGET_URL_SCHEME), and MainActivity checks it. Not https:
     * the Bridge never loads it, AppPlugin only reports it.
     */
    static final String SCHEME = "cardipaw-widget";
    private static final int FLAGS = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;

    private WidgetIntents() {}

    static PendingIntent openPet(Context ctx, int requestCode, String petId) {
        Uri uri = new Uri.Builder().scheme(SCHEME).authority("pet").appendPath(petId).build();
        return open(ctx, requestCode, uri);
    }

    static PendingIntent openHome(Context ctx, int requestCode) {
        return open(ctx, requestCode, new Uri.Builder().scheme(SCHEME).authority("home").build());
    }

    private static PendingIntent open(Context ctx, int requestCode, Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri, ctx, MainActivity.class);
        return PendingIntent.getActivity(ctx, requestCode, intent, FLAGS);
    }

    /** The pet picker for this widget (its pet was deleted, or none was picked). */
    static PendingIntent configure(Context ctx, int widgetId) {
        Uri uri = new Uri.Builder().scheme(SCHEME).authority("configure").appendPath(Integer.toString(widgetId)).build();
        Intent intent = new Intent(ctx, WidgetConfigureActivity.class)
            .setAction(AppWidgetManager.ACTION_APPWIDGET_CONFIGURE)
            .setData(uri)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        return PendingIntent.getActivity(ctx, widgetId, intent, FLAGS);
    }
}
