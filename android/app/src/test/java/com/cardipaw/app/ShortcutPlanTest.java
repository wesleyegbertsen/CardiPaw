package com.cardipaw.app;

import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.Test;

public class ShortcutPlanTest {

    private static List<String> pets(String... ids) {
        return Arrays.asList(ids);
    }

    /** In the given order, so the plan's lists have a fixed order too. */
    private static Set<String> ids(String... ids) {
        return new LinkedHashSet<>(Arrays.asList(ids));
    }

    private static Map<String, Integer> ranks(String... ids) {
        Map<String, Integer> ranks = new LinkedHashMap<>();
        for (String id : ids) ranks.put(id, ranks.size());
        return ranks;
    }

    @Test
    public void ranksTheShortcutsInTheAppsOrder() {
        ShortcutPlan plan = ShortcutPlan.plan(pets("c", "a", "b"), ids(), ids(), 4);
        assertEquals(ranks("measure:c", "measure:a", "measure:b"), plan.dynamic);
        assertEquals(Arrays.asList("measure:c", "measure:a", "measure:b"), new ArrayList<>(plan.dynamic.keySet()));
    }

    @Test
    public void makesAtMostMaxShortcuts() {
        ShortcutPlan plan = ShortcutPlan.plan(pets("a", "b", "c", "d", "e"), ids(), ids(), 4);
        assertEquals(ranks("measure:a", "measure:b", "measure:c", "measure:d"), plan.dynamic);
    }

    @Test
    public void followsALowerMax() {
        ShortcutPlan plan = ShortcutPlan.plan(pets("a", "b", "c"), ids(), ids(), 2);
        assertEquals(ranks("measure:a", "measure:b"), plan.dynamic);
    }

    @Test
    public void ignoresPinsWithoutTheMeasurePrefix() {
        ShortcutPlan plan = ShortcutPlan.plan(pets("a"), ids("other:a", "a", "z"), ids("other:a", "z"), 4);
        assertEquals(Collections.emptyList(), plan.update);
        assertEquals(Collections.emptyList(), plan.enable);
        assertEquals(Collections.emptyList(), plan.blank);
    }

    @Test
    public void leavesATopPetsPinToTheDynamicShortcuts() {
        // setDynamicShortcuts updates it, and enables it again.
        ShortcutPlan plan = ShortcutPlan.plan(pets("a"), ids("measure:a"), ids("measure:a"), 4);
        assertEquals(Collections.emptyList(), plan.update);
        assertEquals(Collections.emptyList(), plan.enable);
        assertEquals(Collections.emptyList(), plan.blank);
    }

    @Test
    public void blanksThePinOfAPetThatIsGone() {
        ShortcutPlan plan = ShortcutPlan.plan(pets("a"), ids("measure:gone", "measure:a"), ids(), 4);
        assertEquals(Collections.singletonList("measure:gone"), plan.blank);
        assertEquals(Collections.emptyList(), plan.update);
        assertEquals(Collections.emptyList(), plan.enable);
    }

    @Test
    public void blanksAnAlreadyDisabledPinAgain() {
        // So its label and message follow the app's language.
        ShortcutPlan plan = ShortcutPlan.plan(pets("a"), ids("measure:gone"), ids("measure:gone"), 4);
        assertEquals(Collections.singletonList("measure:gone"), plan.blank);
    }

    @Test
    public void updatesThePinOfAPetBeyondTheTop() {
        ShortcutPlan plan = ShortcutPlan.plan(pets("a", "b", "c"), ids("measure:c"), ids(), 2);
        assertEquals(Collections.singletonList("measure:c"), plan.update);
        assertEquals(Collections.emptyList(), plan.enable);
        assertEquals(Collections.emptyList(), plan.blank);
    }

    @Test
    public void enablesTheDisabledPinOfAPetThatCameBack() {
        ShortcutPlan plan = ShortcutPlan.plan(
            pets("a", "b", "c"),
            ids("measure:b", "measure:c"),
            ids("measure:b", "measure:c"),
            1
        );
        assertEquals(Arrays.asList("measure:b", "measure:c"), plan.update);
        assertEquals(Arrays.asList("measure:b", "measure:c"), plan.enable);
    }

    @Test
    public void disablesEveryPinWhenThereAreNoPets() {
        ShortcutPlan plan = ShortcutPlan.plan(pets(), ids("measure:a", "other:x", "measure:b"), ids("measure:b"), 4);
        assertEquals(Collections.emptyMap(), plan.dynamic);
        assertEquals(Arrays.asList("measure:a", "measure:b"), plan.blank);
        assertEquals(Collections.emptyList(), plan.update);
    }

    @Test
    public void makesOneShortcutForAPetIdListedTwice() {
        ShortcutPlan plan = ShortcutPlan.plan(pets("a", "a", "b"), ids(), ids(), 4);
        assertEquals(ranks("measure:a", "measure:b"), plan.dynamic);
    }
}
