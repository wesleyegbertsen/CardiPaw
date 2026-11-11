package com.cardipaw.app.widget;

import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

/**
 * "Measured today at 08:12" / "Measured yesterday" / ... in the app's wording
 * (src/composables/useLastMeasured.ts): calendar days in the device's time zone. No java.time
 * (minSdk 24 without desugaring).
 */
public final class WidgetAge {

    private WidgetAge() {}

    /** Local calendar day as "YYYY-MM-DD", the same as localDayKey in src/utils/date.ts. */
    public static String dayKey(long epochMs, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz, Locale.ROOT);
        c.setTimeInMillis(epochMs);
        return String.format(
            Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    /** Calendar days from takenAt's local day to now's; negative for a reading dated after today. */
    public static int daysBetween(long takenAt, long now, TimeZone tz) {
        // Each local day as a UTC midnight: an exact multiple of a day apart, whatever DST did.
        return (int) ((utcMidnight(now, tz) - utcMidnight(takenAt, tz)) / 86_400_000L);
    }

    private static long utcMidnight(long epochMs, TimeZone tz) {
        Calendar local = Calendar.getInstance(tz, Locale.ROOT);
        local.setTimeInMillis(epochMs);
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
        utc.clear();
        utc.set(local.get(Calendar.YEAR), local.get(Calendar.MONTH), local.get(Calendar.DAY_OF_MONTH));
        return utc.getTimeInMillis();
    }

    /**
     * The age line. `time` is takenAt's time of day, formatted by the caller (it needs a Context
     * for the 12/24-hour setting); used only for a reading taken earlier today.
     */
    public static String label(WidgetSnapshot.Strings s, long takenAt, long now, TimeZone tz, String time) {
        int days = daysBetween(takenAt, now, tz);
        // Dated after today (a clock that was ahead): "today", no time.
        if (days < 0) return s.today;
        if (days == 0) return takenAt > now ? s.today : WidgetText.fill(s.todayAt, "time", time);
        if (days == 1) return s.yesterday;
        if (days <= 6) return s.daysAgo.format(days);
        return s.weeksAgo.format(days / 7);
    }

    /** The app shows the age in its warning colour after 3 days (useLastMeasured's isStale). */
    public static boolean isStale(long takenAt, long now, TimeZone tz) {
        return daysBetween(takenAt, now, tz) > 3;
    }

    /** The next local midnight after now (for the redraw alarm). */
    public static long nextMidnight(long now, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz, Locale.ROOT);
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        c.add(Calendar.DAY_OF_MONTH, 1);
        return c.getTimeInMillis();
    }
}
