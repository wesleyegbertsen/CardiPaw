package com.cardipaw.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

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
