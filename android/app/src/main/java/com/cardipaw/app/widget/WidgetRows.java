package com.cardipaw.app.widget;

/** How the all-pets widget fills its height (pure: JUnit). */
final class WidgetRows {

    /**
     * widget_all_pets_row.xml's minHeight, widget_all_pets_more.xml's height, and
     * widget_all_pets.xml's top + bottom padding.
     */
    static final int ROW_DP = 52, MORE_DP = 48, PADDING_DP = 16;
    /** widget_all_pets_info.xml's minHeight, for a launcher that reports no size. */
    static final int DEFAULT_HEIGHT_DP = 110;

    private WidgetRows() {}

    /**
     * Pet rows to show; the caller adds a "+N more" row when this is less than the pet count. A row
     * grows with the system font size (wrap_content), never below ROW_DP.
     */
    static int petRows(int heightDp, int pets, float fontScale) {
        int row = (int) Math.ceil(ROW_DP * Math.max(1f, fontScale));
        int room = heightDp - PADDING_DP;
        if (pets * row <= room) return pets;
        // Not all fit: leave room for "+N more", but always show at least one pet.
        return Math.max(1, Math.min(pets, (room - MORE_DP) / row));
    }

    /**
     * Before API 31, the height in the current orientation (0: not reported): by the documented
     * convention MAX_HEIGHT is the portrait height and MIN_HEIGHT the landscape one. API 31+ gets
     * each orientation's exact size (OPTION_APPWIDGET_SIZES) instead.
     */
    static int heightDp(int minHeightDp, int maxHeightDp, boolean portrait) {
        int preferred = portrait ? maxHeightDp : minHeightDp;
        if (preferred > 0) return preferred;
        if (minHeightDp > 0) return minHeightDp;
        if (maxHeightDp > 0) return maxHeightDp;
        return DEFAULT_HEIGHT_DP;
    }
}
