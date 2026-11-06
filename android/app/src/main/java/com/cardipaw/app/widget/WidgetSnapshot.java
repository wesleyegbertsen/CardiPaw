package com.cardipaw.app.widget;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What the web app last sent (src/utils/widgetSnapshot.ts builds it). Pure Java + org.json, so
 * JUnit can run it on the JVM. Any shape problem throws: the caller shows "Open CardiPaw".
 */
public final class WidgetSnapshot {

    public static final int VERSION = 1;
    // Arrays.asList, not List.of: List.of is Android 11+ and minSdk is 24.
    static final List<String> STATUSES = Arrays.asList("normal", "warning", "danger");
    static final List<String> ALERTS = Arrays.asList("rising", "aboveCeiling");

    /** A message in its "one" and "other" plural forms, each with a literal {n}. */
    public static final class Plural {
        public final String one;
        public final String other;

        Plural(JSONObject o) throws JSONException {
            one = o.getString("one");
            other = o.getString("other");
        }

        /** vue-i18n's default rule for a two-form message: 1 takes "one", every other n "other". */
        public String format(int n) {
            return WidgetText.fill(n == 1 ? one : other, "n", Integer.toString(n));
        }
    }

    public static final class Strings {
        public final String bpm, today, todayAt, yesterday, noReadings, noPets, petMissing;
        public final String a11yReading, a11yNoReadings;
        public final Map<String, String> status;
        public final Map<String, String> trend;
        public final Plural daysAgo, weeksAgo, more;

        Strings(JSONObject o) throws JSONException {
            bpm = o.getString("bpm");
            today = o.getString("today");
            todayAt = o.getString("todayAt");
            yesterday = o.getString("yesterday");
            noReadings = o.getString("noReadings");
            noPets = o.getString("noPets");
            petMissing = o.getString("petMissing");
            a11yReading = o.getString("a11yReading");
            a11yNoReadings = o.getString("a11yNoReadings");
            status = stringMap(o.getJSONObject("status"), STATUSES);
            trend = stringMap(o.getJSONObject("trend"), ALERTS);
            daysAgo = new Plural(o.getJSONObject("daysAgo"));
            weeksAgo = new Plural(o.getJSONObject("weeksAgo"));
            more = new Plural(o.getJSONObject("more"));
        }
    }

    public static final class Latest {
        public final int rate;
        /** normal | warning | danger (getRateStatus's cssClass). */
        public final String status;
        public final long takenAt;

        Latest(JSONObject o) throws JSONException {
            rate = o.getInt("rate");
            status = oneOf(o.getString("status"), STATUSES, "status");
            takenAt = o.getLong("takenAt");
        }
    }

    public static final class Pet {
        public final String id, name, initial;
        /** null: no readings yet. */
        public final Latest latest;
        /** Local day key ("YYYY-MM-DD") to rising | aboveCeiling; only days with an alert. */
        public final Map<String, String> alerts;

        Pet(JSONObject o) throws JSONException {
            id = o.getString("id");
            name = o.getString("name");
            initial = o.getString("initial");
            latest = o.isNull("latest") ? null : new Latest(o.getJSONObject("latest"));
            JSONObject a = o.getJSONObject("alerts");
            Map<String, String> m = new HashMap<>();
            for (Iterator<String> it = a.keys(); it.hasNext(); ) {
                String day = it.next();
                m.put(day, oneOf(a.getString(day), ALERTS, "alert"));
            }
            alerts = Collections.unmodifiableMap(m);
        }
    }

    public final String locale;
    public final Strings strings;
    public final List<Pet> pets;

    private WidgetSnapshot(JSONObject o) throws JSONException {
        int v = o.getInt("v");
        if (v != VERSION) throw new JSONException("Unsupported widget snapshot version " + v);
        locale = o.getString("locale");
        strings = new Strings(o.getJSONObject("strings"));
        JSONArray a = o.getJSONArray("pets");
        List<Pet> list = new ArrayList<>(a.length());
        for (int i = 0; i < a.length(); i++) list.add(new Pet(a.getJSONObject(i)));
        pets = Collections.unmodifiableList(list);
    }

    /** Throws JSONException for anything but a well-formed version 1 snapshot. */
    public static WidgetSnapshot parse(String json) throws JSONException {
        // Android's JSONObject(null) throws a NullPointerException, not a JSONException.
        if (json == null) throw new JSONException("No widget snapshot");
        return new WidgetSnapshot(new JSONObject(json));
    }

    public Pet find(String id) {
        for (Pet p : pets) if (p.id.equals(id)) return p;
        return null;
    }

    private static String oneOf(String value, List<String> allowed, String what) throws JSONException {
        if (!allowed.contains(value)) throw new JSONException("Unknown " + what + " " + value);
        return value;
    }

    private static Map<String, String> stringMap(JSONObject o, List<String> keys) throws JSONException {
        Map<String, String> m = new HashMap<>();
        for (String k : keys) m.put(k, o.getString(k));
        return Collections.unmodifiableMap(m);
    }
}
