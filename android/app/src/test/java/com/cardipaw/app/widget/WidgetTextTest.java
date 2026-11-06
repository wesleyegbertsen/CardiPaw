package com.cardipaw.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class WidgetTextTest {

    @Test
    public void fillsEveryKey() {
        assertEquals(
            "Milo: 24 breaths per minute, Normal.",
            WidgetText.fill("{name}: {rate} breaths per minute, {status}.", "rate", "24", "status", "Normal", "name", "Milo"));
    }

    @Test
    public void fillsAKeyThatAppearsTwice() {
        assertEquals("3 and 3", WidgetText.fill("{n} and {n}", "n", "3"));
    }

    @Test
    public void leavesAnUnknownPlaceholder() {
        assertEquals("Measured today at {time}", WidgetText.fill("Measured today at {time}", "n", "1"));
    }

    @Test
    public void rejectsAKeyWithoutAValue() {
        assertThrows(IllegalArgumentException.class, () -> WidgetText.fill("{n}", "n"));
    }

    @Test
    public void doesNotExpandUserTextFilledLast() {
        // A pet named "{age}": its name is filled after age, so it stays as typed.
        assertEquals("{age}: x", WidgetText.fill("{name}: {age}", "age", "x", "name", "{age}"));
    }
}
