package com.cardipaw.app.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Bundle;

/** One pet's latest reading; the pet is picked in WidgetConfigureActivity. */
public class PetWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) WidgetUpdater.updatePet(ctx, mgr, id);
        WidgetUpdater.scheduleMidnight(ctx);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle options) {
        // Resized: below API 31 the layout is picked from the height.
        WidgetUpdater.updatePet(ctx, mgr, id);
    }

    @Override
    public void onDeleted(Context ctx, int[] ids) {
        WidgetStore.forget(ctx, ids);
    }

    @Override
    public void onDisabled(Context ctx) {
        // The last single-pet widget is gone: only all-pets widgets still need the midnight redraw.
        // Their count alone, in case this kind's last id is still listed during the broadcast.
        if (!WidgetUpdater.needsMidnight(0, WidgetUpdater.count(ctx, AllPetsWidgetProvider.class))) {
            WidgetUpdater.cancelMidnight(ctx);
        }
    }
}
