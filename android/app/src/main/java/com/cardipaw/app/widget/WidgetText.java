package com.cardipaw.app.widget;

/** Fills the literal {key} placeholders the snapshot's strings keep (vue-i18n left them as is). */
public final class WidgetText {

    private WidgetText() {}

    /**
     * keyValues: key1, value1, key2, value2, ... Every {key} is replaced; others stay. A value can
     * hold a later key's placeholder, so pass user text (a pet's name) last: it is never re-scanned.
     */
    public static String fill(String template, String... keyValues) {
        if (keyValues.length % 2 != 0) throw new IllegalArgumentException("key without a value");
        String out = template;
        for (int i = 0; i < keyValues.length; i += 2) {
            out = out.replace("{" + keyValues[i] + "}", keyValues[i + 1]);
        }
        return out;
    }
}
