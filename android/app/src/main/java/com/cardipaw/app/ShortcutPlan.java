package com.cardipaw.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * What one sync of LauncherShortcutsPlugin does with each shortcut id. No Android types, so the
 * JVM unit tests (src/test) run it without an emulator.
 */
final class ShortcutPlan {

    // Our shortcuts only, so other kinds can be added later.
    static final String ID_PREFIX = "measure:";

    /** The long-press shortcuts, in the app's order, with their rank. */
    final Map<String, Integer> dynamic;
    /** Pins of the other pets: updated with the pet's label and photo. */
    final List<String> update;
    /** Those of them that are disabled: pets an import brought back. */
    final List<String> enable;
    /** Pins of pets that are gone: given the deleted label and the app icon, then disabled. */
    final List<String> blank;

    private ShortcutPlan(Map<String, Integer> dynamic, List<String> update, List<String> enable, List<String> blank) {
        this.dynamic = Collections.unmodifiableMap(dynamic);
        this.update = Collections.unmodifiableList(update);
        this.enable = Collections.unmodifiableList(enable);
        this.blank = Collections.unmodifiableList(blank);
    }

    static String shortcutId(String petId) {
        return ID_PREFIX + petId;
    }

    /**
     * @param petIds every pet, in the app's order
     * @param pinned the ids of every pinned shortcut of the app
     * @param disabled the pinned ids that are disabled
     * @param max how many long-press shortcuts there may be
     */
    static ShortcutPlan plan(List<String> petIds, Set<String> pinned, Set<String> disabled, int max) {
        Set<String> ids = new LinkedHashSet<>();
        for (String petId : petIds) ids.add(shortcutId(petId));
        Map<String, Integer> dynamic = new LinkedHashMap<>();
        for (String id : ids) {
            if (dynamic.size() == max) break;
            dynamic.put(id, dynamic.size());
        }
        List<String> update = new ArrayList<>();
        List<String> enable = new ArrayList<>();
        List<String> blank = new ArrayList<>();
        for (String id : pinned) {
            // A top pet's pin: setDynamicShortcuts updates it, and enables it again.
            if (!id.startsWith(ID_PREFIX) || dynamic.containsKey(id)) continue;
            if (!ids.contains(id)) {
                blank.add(id);
                continue;
            }
            update.add(id);
            if (disabled.contains(id)) enable.add(id);
        }
        return new ShortcutPlan(dynamic, update, enable, blank);
    }
}
