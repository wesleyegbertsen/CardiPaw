package com.cardipaw.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import org.junit.Test;

public class MainActivityTest {

    private static final int HISTORY = Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY;

    @Test
    public void forgetsTheShortcutOfARestoredActivity() {
        assertTrue(MainActivity.shouldForgetShortcut(true, 0));
    }

    @Test
    public void forgetsTheShortcutOfAnActivityReopenedFromRecents() {
        assertTrue(MainActivity.shouldForgetShortcut(false, HISTORY));
        assertTrue(MainActivity.shouldForgetShortcut(false, HISTORY | Intent.FLAG_ACTIVITY_NEW_TASK));
    }

    @Test
    public void forgetsTheShortcutOfARestoredActivityReopenedFromRecents() {
        assertTrue(MainActivity.shouldForgetShortcut(true, HISTORY));
    }

    @Test
    public void keepsTheShortcutOfANewLaunch() {
        assertFalse(MainActivity.shouldForgetShortcut(false, 0));
        assertFalse(MainActivity.shouldForgetShortcut(false, Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
