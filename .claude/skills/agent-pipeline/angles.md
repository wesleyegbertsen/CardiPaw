# Angle presets

Pick the preset that matches the task, or blend two. Each preset gives three
analysis angles (Phase 1), three or more review angles (Phase 5) and the
validation check (Phase 7). Adjust angles to the scope; for example, drop the
accessibility reviewer for backend-only work and add a security one instead.

## Feature

**Analyze**
1. **Product and UX:** user flows, edge cases, empty, error and loading states,
   a11y, i18n, and how it fits existing screens and patterns.
2. **Architecture and data:** where it lives, data model and storage changes,
   migrations, the APIs and modules it touches, reuse of existing code.
3. **Risk:** data loss or corruption, security and privacy, performance,
   backwards compatibility (old data, old links, old clients), and the testing
   strategy.

**Review**
1. Correctness and behaviour against the plan and the user's request.
2. Tests: do they cover the new behaviour, and do they fail when it breaks?
   Include mutation spot-checks.
3. UX, a11y and i18n of the new UI.
4. Maintainability, security and CI fit.

**Validate:** walk through the feature in the running app (`verify`/`run`
skill), including the error paths. Run every CI check.

## Missing tests

**Analyze**
1. Pure logic and data layer: utils, services, stores, routing, i18n.
2. UI components and views: rendering, events, forms, navigation, keyboard and
   a11y behaviour.
3. Risk-based: data integrity, untrusted input, timezones, security; also gaps
   in the existing tests.

**Review**
1. Correctness of any production fixes.
2. Test effectiveness and robustness: repeated and shuffled runs, mutation
   spot-checks, flakiness.
3. A11y, UX and i18n of any UI fixes.
4. Maintainability and CI: helper reuse, duplication, type safety, runtime.

**Validate:** measure coverage, install the coverage tool without saving it to
the manifest, and fill significant cheap gaps once. Do a browser check of the
fixed UI bugs.

## Bug batch

**Analyze**
1. Reproduce each bug and find its root cause.
2. Find related places with the same pattern, so a whole class gets fixed
   instead of one instance.
3. Blast radius: what else depends on the code being changed, and what could
   regress.

**Review**
1. Each fix addresses the root cause, without side effects.
2. Regression tests fail on the old code. Revert each fix and confirm.
3. Regressions elsewhere: callers, data compatibility.

**Validate:** reproduce each original bug report in the running app and
confirm it is gone.

## Refactor / migration

**Analyze**
1. Inventory every site and caller in scope.
2. Target design and conventions; incremental steps that keep it working.
3. Behavioural risks and test coverage of the code being changed (add
   characterization tests first where coverage is missing).

**Review**
1. Behaviour is unchanged: diff review against the old code.
2. Completeness: no sites missed, no leftover dead code.
3. Maintainability and readability of the result.

**Validate:** the full test suite passes before and after, and the bundle size
or build output is compared if relevant.

## Performance

**Analyze**
1. Measure: profile the hot paths, bundle and chunk sizes, load and render timings.
2. Algorithms, data access and caching opportunities.
3. Risks to correctness, plus how to benchmark reliably.

**Review**
1. Correctness is preserved.
2. Measured gains are real and reproducible.
3. Maintainability cost of each optimization.

**Validate:** before and after numbers from the same benchmark, run several times.
