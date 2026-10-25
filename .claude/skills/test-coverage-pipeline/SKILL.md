---
name: test-coverage-pipeline
description: Find missing tests, plan them in three refining passes, implement them (fixing the bugs they expose), review from several angles, fix the findings, validate coverage, then push and open or update the PR. Use when asked to add missing tests across the codebase or a scope such as "components and views".
---

# Test coverage pipeline

A multi-agent process for adding the tests a codebase is missing, and fixing the
bugs those tests expose, as one reviewable PR. The agent work runs as the saved
workflow `.claude/workflows/test-coverage-pipeline.js`. You (the main session)
own the steps that face the outside world: the manual UI check, pushing, and
the PR.

Invoking this skill is the user's opt-in to running the workflow.

## Phases

| # | Phase | Who | What |
|---|---|---|---|
| 1 | Analyze | 3 agents in parallel | Independent missing-test analyses: logic and data layer; UI and user flows; data-integrity and security risk (plus gaps in the existing tests) |
| 2 | Report | 1 agent | Merges them into one prioritized report with a bug table |
| 3 | Plan | 3 agents in sequence | Pass 1 drafts; pass 2 checks it against the real source and prototypes risky infra; pass 3 stress-tests and outputs the final plan split into commit batches |
| 4 | Implement | 1 agent per batch, in sequence | One conventional commit per item, every commit green, regression test written first and seen failing for every fix |
| 5 | Review | 4 agents in parallel | Correctness; test effectiveness (shuffled runs, mutation spot-checks); a11y, UX and i18n; maintainability, security and CI |
| 6 | Fix | 2 agents | Triage the combined findings into "fix now" and "deferred", then implement the fixes |
| 7 | Validate | 1 agent | Measure coverage, fill significant cheap gaps once, list what remains |

## Steps

1. **Prepare.** Make sure you are on the branch you are allowed to push to and
   that the tree is clean. Install dependencies and run the test suite once to
   get a baseline count.

2. **Pick the scope.** Use what the user asked for ("the whole codebase",
   "components and views", "src/services"). For a follow-up round, collect
   context: what earlier rounds covered, the helpers they added, and the
   deferred items, so agents build on them instead of repeating them.

3. **Run the workflow.**
   ```
   Workflow({
     name: "test-coverage-pipeline",
     args: {
       scope: "<scope>",
       commitTrailer: "<the attribution lines this session must end commits with>",
       context: "<optional: earlier rounds, deferred items, conventions>"
     }
   })
   ```
   If the name doesn't resolve, pass
   `scriptPath: ".claude/workflows/test-coverage-pipeline.js"` instead. Optional
   args: `baseRef` (defaults to HEAD at start), `analysisAngles` (3 strings),
   and `reviewAngles` (3 or more strings). Use these to aim the angles at the
   scope; for example, a backend-only scope has no a11y reviewer.
   The workflow commits locally and never pushes.

4. **Check the result yourself.** Don't relay the agents' claims unchecked:
   - `git status` is clean, and `git log <base>..HEAD` matches the reported commits.
   - Run every CI check yourself: lint, typecheck, tests (also shuffled, and
     under another `TZ` when dates matter), locale or other checks, and build.
   - Spot-check one or two fixes by reverting them and confirming a test fails.

5. **Manual UI check.** For each UI bug that was fixed, drive the production
   build in a headless browser. In this repo use the `verify` skill; elsewhere
   use `run`. Fix anything it finds with a test-first commit.

6. **Push and open or update the PR.** Push to your branch. If a PR is already
   open for it, update its title and description instead of opening a new one.
   Follow the repo's PR template if there is one; otherwise use: Summary, Bug
   fixes (each one notes that its regression test failed before the fix),
   Test infrastructure, Verification (commands, coverage table, manual checks),
   and Deferred follow-ups. A PR title must be a conventional commit when the
   repo enforces it.

7. **Report to the user.** Give the test count and coverage before and after,
   the bugs fixed, what was deferred and why, and the PR link. Offer to watch the PR.

## Lessons from earlier runs

- **Give reviewers a shell.** Reviewers that need to run code (tests, mutations)
  must be general-purpose agents. Read-only review agent types can't run
  anything, and their reports then rest on reading alone.
- **Check the test DOM can run what you're testing.** DOMPurify does not
  sanitize under happy-dom 18, so sanitizer tests need jsdom. Verify that a
  test environment can actually exercise a security-relevant library before
  trusting tests written in it.
- **Pin and assert timezones.** Pin `TZ` in the test config. Have the timezone
  helper assert that the zone took effect: timezone stubbing fails silently
  under vitest's threads pool.
- **Fake only `Date` around fake IndexedDB.** fake-indexeddb hangs under full
  fake timers.
- **Watch for "stored values exempt" rules.** Bounds on user input can lock
  users out of editing data that an older version or a backup stored. Keep
  unchanged stored values saveable. Check that native form validation
  (`required`/`min`/`max` without `novalidate`) doesn't silently block the
  submit anyway.
- **Implement in batches.** One agent per batch of about 6–10 commits keeps each
  agent's context manageable. The batches run in sequence because they share
  the working tree.
- **Check exit codes.** Agents have let a pipe hide a failing check. Require
  them to check every exit code, and re-run the checks yourself before pushing.
