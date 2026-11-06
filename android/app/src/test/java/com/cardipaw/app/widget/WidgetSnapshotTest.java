package com.cardipaw.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

public class WidgetSnapshotTest {

    /**
     * Written by src/utils/widgetSnapshot.test.ts from the TypeScript builder: the contract between
     * the two. Gradle runs unit tests with the module directory (android/app) as the working dir.
     */
    static String fixture() throws Exception {
        return new String(
            Files.readAllBytes(Paths.get("src/test/resources/widget-snapshot-v1.json")), StandardCharsets.UTF_8);
    }

    @Test
    public void readsWhatTheWebAppBuilds() throws Exception {
        WidgetSnapshot s = WidgetSnapshot.parse(fixture());
        assertEquals("en", s.locale);
        assertEquals(4, s.pets.size());
        WidgetSnapshot.Pet milo = s.find("pet-1");
        assertEquals("Milo", milo.name);
        assertEquals("M", milo.initial);
        assertEquals(24, milo.latest.rate);
        assertEquals("normal", milo.latest.status);
        assertEquals(1793952720000L, milo.latest.takenAt);
        assertEquals(0, milo.alerts.size());
        assertEquals("warning", s.find("pet-2").latest.status);
        assertNull(s.find("pet-3").latest);
        assertNull(s.find("nobody"));
        Map<String, String> alerts = new HashMap<>();
        alerts.put("2026-11-06", "rising");
        alerts.put("2026-11-07", "rising");
        assertEquals(alerts, s.find("pet-4").alerts);
        assertEquals("Elevated", s.strings.status.get("warning"));
        assertEquals("Trending up", s.strings.trend.get("rising"));
        assertEquals("Measured today at {time}", s.strings.todayAt);
        assertEquals("+3 more", s.strings.more.format(3));
        assertEquals("Measured 1 day ago", s.strings.daysAgo.format(1));
        assertEquals("Last measured 1 week ago", s.strings.weeksAgo.format(1));
        assertEquals("Last measured 2 weeks ago", s.strings.weeksAgo.format(2));
    }

    @Test
    public void rejectsAnotherVersion() throws Exception {
        JSONObject o = new JSONObject(fixture()).put("v", 2);
        assertThrows(JSONException.class, () -> WidgetSnapshot.parse(o.toString()));
    }

    @Test
    public void rejectsAnUnknownStatus() throws Exception {
        JSONObject o = new JSONObject(fixture());
        o.getJSONArray("pets").getJSONObject(0).getJSONObject("latest").put("status", "purple");
        assertThrows(JSONException.class, () -> WidgetSnapshot.parse(o.toString()));
    }

    @Test
    public void rejectsAnUnknownAlert() throws Exception {
        JSONObject o = new JSONObject(fixture());
        o.getJSONArray("pets").getJSONObject(3).getJSONObject("alerts").put("2026-11-07", "falling");
        assertThrows(JSONException.class, () -> WidgetSnapshot.parse(o.toString()));
    }

    @Test
    public void rejectsAMissingString() throws Exception {
        JSONObject o = new JSONObject(fixture());
        o.getJSONObject("strings").remove("petMissing");
        assertThrows(JSONException.class, () -> WidgetSnapshot.parse(o.toString()));
    }

    @Test
    public void rejectsNothingAtAll() {
        assertThrows(JSONException.class, () -> WidgetSnapshot.parse(null));
        assertThrows(JSONException.class, () -> WidgetSnapshot.parse("not json"));
    }
}
