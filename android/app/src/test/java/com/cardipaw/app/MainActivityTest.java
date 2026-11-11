package com.cardipaw.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import org.junit.Test;

public class MainActivityTest {

    private static final String WIDGET = "cardipaw-widget";

    @Test
    public void aFreshWidgetTapIsKept() {
        assertFalse(MainActivity.shouldForgetTap(false, 0, WIDGET));
    }

    @Test
    public void aRecreatedActivityForgetsTheTap() {
        assertTrue(MainActivity.shouldForgetTap(true, 0, WIDGET));
    }

    @Test
    public void reopeningFromRecentsForgetsTheTap() {
        assertTrue(MainActivity.shouldForgetTap(false, Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY, WIDGET));
    }

    @Test
    public void otherIntentsAreLeftAlone() {
        assertFalse(MainActivity.shouldForgetTap(true, Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY, "https"));
        assertFalse(MainActivity.shouldForgetTap(true, Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY, null));
    }
}
