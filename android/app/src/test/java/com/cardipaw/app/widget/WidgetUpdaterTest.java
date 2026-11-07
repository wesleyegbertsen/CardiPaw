package com.cardipaw.app.widget;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WidgetUpdaterTest {

    @Test
    public void midnightAlarmOnlyWhileAWidgetIsPlaced() {
        assertFalse(WidgetUpdater.needsMidnight(0, 0));
        assertTrue(WidgetUpdater.needsMidnight(1, 0));
        assertTrue(WidgetUpdater.needsMidnight(0, 1));
        assertTrue(WidgetUpdater.needsMidnight(2, 3));
    }
}
