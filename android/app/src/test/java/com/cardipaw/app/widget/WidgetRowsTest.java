package com.cardipaw.app.widget;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class WidgetRowsTest {

    @Test
    public void allFit() {
        assertEquals(3, WidgetRows.petRows(200, 3));
    }

    @Test
    public void oneShortLeavesRoomForMore() {
        // 184dp inside the padding; 4 rows need 208dp, so (184 - 32) / 52 = 2 pets and "+2 more".
        assertEquals(2, WidgetRows.petRows(200, 4));
    }

    @Test
    public void tinyShowsOnePet() {
        assertEquals(1, WidgetRows.petRows(60, 5));
    }

    @Test
    public void exactFit() {
        // 2 rows of 52dp in 120 - 16 = 104dp: no "+N more" row needed.
        assertEquals(2, WidgetRows.petRows(120, 2));
    }

    @Test
    public void zeroPets() {
        assertEquals(0, WidgetRows.petRows(200, 0));
    }
}
