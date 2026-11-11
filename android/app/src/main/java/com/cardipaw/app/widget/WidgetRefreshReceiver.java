package com.cardipaw.app.widget;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Redraws after midnight (our alarm) and after a clock, time zone, 12/24-hour or language change
 * (TIME_SET, TIMEZONE_CHANGED and LOCALE_CHANGED are exempt from the API 26 implicit broadcast
 * limits; DATE_CHANGED is not, hence the alarm). Exported for those; anything that reaches it
 * can only cause a redraw.
 */
public class WidgetRefreshReceiver extends BroadcastReceiver {

    static final String ACTION_MIDNIGHT = "com.cardipaw.app.widget.MIDNIGHT";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        switch (action) {
            case ACTION_MIDNIGHT:
            case Intent.ACTION_TIME_CHANGED: // "android.intent.action.TIME_SET"
            case Intent.ACTION_TIMEZONE_CHANGED:
            case Intent.ACTION_LOCALE_CHANGED:
                WidgetUpdater.updateAll(ctx);
                break;
            default:
                // Anything else sent to this exported receiver is ignored.
        }
    }
}
