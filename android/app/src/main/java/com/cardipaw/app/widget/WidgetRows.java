package com.cardipaw.app.widget;

/** How the all-pets widget fills its height (pure: JUnit). */
final class WidgetRows {

    /** widget_all_pets_row.xml, widget_all_pets_more.xml, and widget_all_pets.xml's top + bottom padding. */
    static final int ROW_DP = 52, MORE_DP = 32, PADDING_DP = 16;

    private WidgetRows() {}

    /** Pet rows to show; the caller adds a "+N more" row when this is less than the pet count. */
    static int petRows(int heightDp, int pets) {
        int room = heightDp - PADDING_DP;
        if (pets * ROW_DP <= room) return pets;
        // Not all fit: leave room for "+N more", but always show at least one pet.
        return Math.max(1, Math.min(pets, (room - MORE_DP) / ROW_DP));
    }
}
