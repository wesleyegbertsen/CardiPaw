package com.cardipaw.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.TimeZone;
import org.json.JSONObject;
import org.junit.Test;

public class WidgetUpdaterTest {

    @Test
    public void midnightAlarmOnlyWhileAWidgetIsPlaced() {
        assertFalse(WidgetUpdater.needsMidnight(0, 0));
        assertTrue(WidgetUpdater.needsMidnight(1, 0));
        assertTrue(WidgetUpdater.needsMidnight(0, 1));
        assertTrue(WidgetUpdater.needsMidnight(2, 3));
    }

    @Test
    public void threeLinesOnA2x1UpToLargeText() {
        // A Pixel launcher's 2x1 is 179x99dp in portrait. Its three lines fit at 1x and 1.3x;
        // at 2x they would be cut, so the two-line layout shows.
        assertTrue(WidgetUpdater.petMediumHeightDp(1f) <= 99);
        assertTrue(WidgetUpdater.petMediumHeightDp(1.3f) <= 99);
        assertTrue(WidgetUpdater.petMediumHeightDp(2f) > 100);
        // Smaller text keeps the 1x room.
        assertEquals(WidgetUpdater.petMediumHeightDp(1f), WidgetUpdater.petMediumHeightDp(0.85f));
    }

    @Test
    public void alertIsTheOneForTodayInTheDevicesTimeZone() throws Exception {
        // pet-4's alerts: 2026-11-06 and 2026-11-07.
        WidgetSnapshot s = WidgetSnapshot.parse(WidgetSnapshotTest.fixture());
        WidgetSnapshot.Pet bella = s.find("pet-4");
        TimeZone ams = TimeZone.getTimeZone("Europe/Amsterdam");
        TimeZone la = TimeZone.getTimeZone("America/Los_Angeles");
        long nov7Noon = 1794052800000L; // 2026-11-07T12:00Z
        assertEquals("rising", WidgetUpdater.alertFor(bella, nov7Noon, ams));
        // A day later: the alert is over.
        assertNull(WidgetUpdater.alertFor(bella, nov7Noon + 86_400_000L, ams));
        // 2026-11-08T03:00Z: already the 8th in Amsterdam, still the 7th in Los Angeles.
        long nov8Early = nov7Noon + 15 * 3_600_000L;
        assertNull(WidgetUpdater.alertFor(bella, nov8Early, ams));
        assertEquals("rising", WidgetUpdater.alertFor(bella, nov8Early, la));
        assertNull(WidgetUpdater.alertFor(s.find("pet-1"), nov7Noon, ams));
    }

    @Test
    public void missingPetMessageTellsNeverPickedFromDeleted() {
        assertEquals("Choose a pet", WidgetUpdater.missingPetMessage(null, "Choose a pet", "Removed"));
        assertEquals("Removed", WidgetUpdater.missingPetMessage("pet-9", "Choose a pet", "Removed"));
    }

    @Test
    public void trendSentenceUsesTheSnapshotsWording() throws Exception {
        WidgetSnapshot.Strings en = WidgetSnapshot.parse(WidgetSnapshotTest.fixture()).strings;
        assertEquals(" Trending up.", WidgetUpdater.trendSentence(en, "rising"));
        assertEquals(" Above normal.", WidgetUpdater.trendSentence(en, "aboveCeiling"));
        // Japanese: no space before it, a full-width full stop.
        JSONObject o = new JSONObject(WidgetSnapshotTest.fixture());
        o.getJSONObject("strings").put("a11yTrend", "{trend}。").getJSONObject("trend").put("rising", "上昇傾向");
        WidgetSnapshot.Strings ja = WidgetSnapshot.parse(o.toString()).strings;
        assertEquals("上昇傾向。", WidgetUpdater.trendSentence(ja, "rising"));
    }
}
