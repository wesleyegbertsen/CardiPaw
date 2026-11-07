package com.cardipaw.app.widget;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class WidgetRowsTest {

    @Test
    public void allFit() {
        assertEquals(3, WidgetRows.petRows(200, 3, 1f));
    }

    @Test
    public void oneShortLeavesRoomForMore() {
        // 184dp inside the padding; 4 rows need 208dp, so (184 - 48) / 52 = 2 pets and "+2 more".
        assertEquals(2, WidgetRows.petRows(200, 4, 1f));
    }

    @Test
    public void leavesTheWholeMoreRowFree() {
        // 200dp inside the padding; 4 rows need 208dp. (200 - 48) / 52 = 2: a 32dp "+N more"
        // row would have let 3 pets in, and clipped the larger "+N more" text.
        assertEquals(2, WidgetRows.petRows(216, 4, 1f));
    }

    @Test
    public void tinyShowsOnePet() {
        assertEquals(1, WidgetRows.petRows(60, 5, 1f));
    }

    @Test
    public void exactFit() {
        // 2 rows of 52dp in 120 - 16 = 104dp: no "+N more" row needed.
        assertEquals(2, WidgetRows.petRows(120, 2, 1f));
    }

    @Test
    public void zeroPets() {
        assertEquals(0, WidgetRows.petRows(200, 0, 1f));
    }

    @Test
    public void largerTextGivesFewerRows() {
        // Rows grow with the text: 78dp each at 1.5x, so 3 no longer fit in 184dp.
        assertEquals(3, WidgetRows.petRows(200, 3, 1f));
        assertEquals(1, WidgetRows.petRows(200, 3, 1.5f));
    }

    @Test
    public void smallerTextKeepsTheRowHeight() {
        // The row's minHeight still holds below 1x.
        assertEquals(WidgetRows.petRows(200, 4, 1f), WidgetRows.petRows(200, 4, 0.85f));
    }

    @Test
    public void heightIsTheSmallerReportedOne() {
        // Portrait (MAX) and landscape (MIN): sized for the smaller, rows never clip in either.
        assertEquals(110, WidgetRows.heightDp(110, 230));
        assertEquals(110, WidgetRows.heightDp(230, 110));
        // A launcher that reports only one, or none.
        assertEquals(230, WidgetRows.heightDp(0, 230));
        assertEquals(230, WidgetRows.heightDp(230, 0));
        assertEquals(WidgetRows.DEFAULT_HEIGHT_DP, WidgetRows.heightDp(0, 0));
    }
}
