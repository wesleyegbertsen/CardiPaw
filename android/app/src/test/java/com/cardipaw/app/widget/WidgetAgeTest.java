package com.cardipaw.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.time.OffsetDateTime;
import java.util.TimeZone;
import org.junit.BeforeClass;
import org.junit.Test;

public class WidgetAgeTest {

    private static final TimeZone AMS = TimeZone.getTimeZone("Europe/Amsterdam");
    /** The fixture's strings: a wording change in en.json shows up here as well. */
    private static WidgetSnapshot.Strings s;

    @BeforeClass
    public static void load() throws Exception {
        s = WidgetSnapshot.parse(WidgetSnapshotTest.fixture()).strings;
    }

    /** JVM tests may use java.time; the app code can't (minSdk 24 without desugaring). */
    private static long at(String iso) {
        return OffsetDateTime.parse(iso).toInstant().toEpochMilli();
    }

    private static String label(String takenAt, String now) {
        return WidgetAge.label(s, at(takenAt), at(now), AMS, "08:12");
    }

    @Test
    public void todayShowsTheTime() {
        assertEquals("Measured today at 08:12", label("2026-11-06T08:12:00+01:00", "2026-11-06T23:59:00+01:00"));
    }

    @Test
    public void aReadingLaterTodayIsTodayWithoutATime() {
        assertEquals("Measured today", label("2026-11-06T20:00:00+01:00", "2026-11-06T09:00:00+01:00"));
    }

    @Test
    public void aReadingOnALaterDayIsToday() {
        assertEquals("Measured today", label("2026-11-09T08:00:00+01:00", "2026-11-06T09:00:00+01:00"));
    }

    @Test
    public void yesterdayRightAfterMidnight() {
        assertEquals("Measured yesterday", label("2026-11-05T23:59:00+01:00", "2026-11-06T00:01:00+01:00"));
    }

    @Test
    public void daysThenWeeks() {
        String now = "2026-11-20T12:00:00+01:00";
        assertEquals("Measured 2 days ago", label("2026-11-18T12:00:00+01:00", now));
        assertEquals("Measured 6 days ago", label("2026-11-14T12:00:00+01:00", now));
        assertEquals("Last measured 1 week ago", label("2026-11-13T12:00:00+01:00", now));
        assertEquals("Last measured 2 weeks ago", label("2026-11-06T12:00:00+01:00", now));
    }

    @Test
    public void weeksRoundDown() {
        // 13 days is still "1 week", as in the app (useLastMeasured floors it).
        assertEquals("Last measured 1 week ago", label("2026-11-07T12:00:00+01:00", "2026-11-20T12:00:00+01:00"));
    }

    @Test
    public void aDstChangeDoesNotShiftTheDay() {
        // Europe/Amsterdam left summer time on 2026-10-25, a 25-hour day: 24.5 hours apart, same day.
        assertEquals(0, WidgetAge.daysBetween(at("2026-10-25T00:30:00+02:00"), at("2026-10-25T23:59:00+01:00"), AMS));
        // It entered summer time on 2026-03-29, a 23-hour day: 23.5 hours apart, the next day.
        assertEquals(1, WidgetAge.daysBetween(at("2026-03-28T23:00:00+01:00"), at("2026-03-29T23:30:00+02:00"), AMS));
    }

    @Test
    public void staleAfterThreeDays() {
        long now = at("2026-11-06T12:00:00+01:00");
        assertFalse(WidgetAge.isStale(at("2026-11-03T08:00:00+01:00"), now, AMS));
        assertTrue(WidgetAge.isStale(at("2026-11-02T23:00:00+01:00"), now, AMS));
    }

    @Test
    public void dayKeyIsTheLocalDay() {
        assertEquals("2026-11-06", WidgetAge.dayKey(at("2026-11-05T23:30:00Z"), AMS));
        assertEquals("2026-11-05", WidgetAge.dayKey(at("2026-11-05T23:30:00Z"), TimeZone.getTimeZone("UTC")));
    }

    @Test
    public void nextMidnightOnADstDay() {
        assertEquals(at("2026-10-26T00:00:00+01:00"), WidgetAge.nextMidnight(at("2026-10-25T01:00:00+02:00"), AMS));
    }
}
