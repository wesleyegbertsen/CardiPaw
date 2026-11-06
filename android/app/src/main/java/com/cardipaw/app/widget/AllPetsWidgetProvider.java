package com.cardipaw.app.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** Every pet's latest reading, in the snapshot's order, as many as fit. */
public class AllPetsWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) WidgetUpdater.updateAllPets(ctx, mgr, id);
        WidgetUpdater.scheduleMidnight(ctx);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        // Resized: a different number of rows fits.
        WidgetUpdater.updateAllPets(ctx, mgr, id);
    }
}
