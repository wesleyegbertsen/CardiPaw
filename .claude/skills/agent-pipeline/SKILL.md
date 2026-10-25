---
name: agent-pipeline
description: Run any substantial task (a feature, missing tests, a batch of bugs, a refactor, a performance pass) through a multi-agent pipeline. Three independent analyses produce one report, three planning passes each refine the last, the plan is implemented in batches, three or more reviewers each take a different angle, their findings are fixed, a final validation pass runs, and the result goes into a PR. Use when the user asks for this process, says "/agent-pipeline <task>", or wants a large change done thoroughly with separate agents.
---

# Agent pipeline

A repeatable process for doing a big task carefully with several agents. Each
phase hands its written output to the next. Independent agents give independent
perspectives, so one agent's blind spots don't decide the result.

```
Analyze ×3 ─▶ Report ─▶ Plan 1 ─▶ Plan 2 ─▶ Plan 3 ─▶ Implement (batches)
     ─▶ Review ×3+ ─▶ Fix plan ─▶ Fix ─▶ Validate ─▶ PR
```

The task comes from the user, or from the skill argument: "add dark-mode
support", "add missing tests for components and views", "fix the open
accessibility bugs". Before Phase 1, pick the matching preset in
[angles.md](angles.md). It sets the analysis angles, the review angles and the
validation check for that kind of task.

## Ground rules

- **You orchestrate; agents do the heavy reading and writing.** Use the Agent
  tool. Brief every agent like a peer that has seen nothing: the repo path, the
  goal, the input files, what to output, size limits, and what it must not do.
- **Save every phase's output to a file** in the scratchpad, e.g.
  `<scratchpad>/pipeline/01-report.md`, `02-plan-1.md`. The next phase's agent
  reads the file, so you never retype long text. Tell an agent which file to
  write. Plan agents can't write files, so either use general-purpose agents or
  save their returned text yourself.
- **Read-only phases are read-only.** Analysts, planners and reviewers must not
  change repo files or git state. Experiments go in a temp directory outside the repo.
- **Only implementers commit.** They commit locally on the current branch and
  never push or touch PRs. You push after checking their work.
- **Run independent agents in parallel**: the three analysts, and the
  reviewers. Run dependent ones in sequence: the planning passes, and the
  implementation batches, which share the working tree.
- **Check what agents claim.** Before you build on a report, check its key
  claims yourself: run the tests, read the cited lines, try reverting a fix.
- **Keep the user posted** with one line per phase transition. Ask only when a
  decision is truly theirs: scope, a product trade-off, or anything outward-facing.

## Phase 1: Analyze (3 agents, in parallel)

Spawn three analysts, one per angle from the preset. Each brief contains:
- the task and its scope, plus context from earlier rounds or decisions;
- its angle, and an instruction to cover the WHOLE task from that angle;
- the expected output: concrete findings with file:line, risks, bugs noticed,
  feasibility notes, and a priority (high/medium/low) with a one-line reason;
- a limit of about 1200 words, and the read-only rule.

Use agents that can run commands (general-purpose) so analysts can run the
tests or try something out.

## Phase 2: Report (you)

Merge the three analyses into `01-report.md`. Include:
- the consensus: what two or three analysts agree on, which is your most reliable signal;
- conflicts, and how the source code settles them;
- a prioritized list of what to build or test;
- bugs and risks found, each with where it is and who found it;
- infrastructure or approach notes.

Keep it under about 1500 words. Write it yourself when you have read the
analyses; delegate it only if they are too large.

## Phase 3: Plan (3 passes, in sequence)

Each pass reads the report and the previous pass, and outputs a full plan (not
a diff) to its own file:

1. **Pass 1, draft.** Turn the report into an implementation plan: an ordered
   list of conventional commits, the files per commit, the intended code for
   any fix, the tests per commit, risks, and what is deferred and why. State
   the scope rules: for example, "fix small, clear-cut bugs the work exposes;
   defer broad behavioural changes".
2. **Pass 2, check against the code.** Verify every assumption against the
   real source. Prototype the riskiest parts in a temp directory. Find tests
   that wouldn't actually fail before their fix, and changes broader than
   intended. Give exact code for fixes. Trim low-value items. Make sure every
   commit stays green. Start with a "Changes vs pass 1" section.
3. **Pass 3, stress-test and finalize.** Spot-check what pass 2 didn't verify.
   Look for what it missed: other callers of changed code, typecheck and lint
   coverage, dependency compatibility, i18n. Settle open questions with a
   one-line justification each. Output the final plan with:
   - the commit sequence, split into batches of about 6–10 commits;
   - exact new strings for every locale, if there are any;
   - a **Definition of Done**: every CI check, extra runs (shuffled tests,
     another timezone), a formatter check on new files, and a manual check list.

Between passes, apply decisions the user already made, e.g. "keep it in one
PR". Planners can't know those unless you say so.

## Phase 4: Implement (1 agent per batch, in sequence)

Give each batch to a general-purpose agent with:
- the final plan file and the batch's commit list, plus notes from earlier
  batches (helpers they added, deviations);
- the implementation rules below;
- a request for a report of about 500 words: commits (hash and subject), test
  count before and after, confirmed fail-before / pass-after cases, deviations,
  and doubts.

Implementation rules:
- Work on the current branch. No push, no PR.
- One conventional commit per plan item. Before every commit, run every check
  CI runs, and check each exit code on its own (a pipe can hide a failure).
- End each commit message with the session's attribution lines, if it has any.
- Bug fixes are test-first: the regression test must fail before the fix and
  pass after. Report it when this was confirmed.
- Never skip, disable or weaken a test.
- Match the surrounding style. Format only new files when the repo isn't fully
  formatted. Put new user-visible strings in every locale.
- If the plan is wrong against the code, do the minimal correct thing and record the deviation.

After each batch: run the checks yourself, check that `git status` is clean,
and push the branch as a checkpoint if you have permission to push to it.

## Phase 5: Review (3 or more agents, in parallel)

Spawn at least three reviewers, one per review angle from the preset. Each one
reviews `git diff <base>..HEAD` and stays read-only. A reviewer that tests
mutations may only restore files with `git checkout -- <file>`, and must leave
`git status` clean. Reviewers that need to run code (tests, mutations, builds)
must be general-purpose agents: read-only reviewer types can't run anything.
Ask for real issues only, each with file:line, a failure scenario and a fix,
ranked by severity, in at most about 700 words.

## Phase 6: Fix plan and fixes

Write `05-review-fix-plan.md` yourself:
- **Check each finding first**, by reading the code or a quick run. Reviewers
  are wrong sometimes; note what you reject and why.
- **Fix now:** production fixes with regression tests, then test and quality
  hardening.
- **Deferred:** each item with a reason (outside the scope, a design
  decision, an existing issue).

Give "Fix now" to one implementer, with the same rules as Phase 4, grouped into
a few logical commits. Then check its work yourself.

## Phase 7: Validate

Run the Definition of Done yourself, plus the validation check from the preset.
For example: coverage for tests, a browser walkthrough for UI features, a
benchmark for performance work. Use the `verify` or `run` skill for UI. If
validation turns up a significant, cheap gap, fill it with one more test-first
commit. List what remains.

## Phase 8: PR

1. Push to your branch. If a PR is already open for it, update its title and
   description rather than opening a new one.
2. Follow the repo's PR template if there is one. Otherwise use these sections:
   - Summary, including the process used
   - Changes / bug fixes, each noting that its test failed before the fix
   - Infrastructure
   - Verification: commands, numbers, manual checks
   - Deferred follow-ups
3. Use a conventional title if the repo enforces one.
4. Report to the user: what changed, the before and after numbers, what was
   deferred, the PR link. Offer to watch the PR for CI results and review comments.

## Follow-up rounds

When the user wants to extend the work ("now also do X"), run the whole
pipeline again on top of the current branch. Give every agent the earlier
round's reports, helpers and deferred list as context, so the new round builds
on them instead of redoing them.

## Lessons from earlier runs

- **Plans get better with each pass.** In one run, pass 2's prototypes found
  that the chosen test DOM couldn't exercise the security library at all. In
  another, pass 3 found that a new validation rule would lock users out of
  editing data an older version had stored. Don't skip passes 2 and 3.
- **Bounds on input need an exemption for stored data.** Keep unchanged stored
  values saveable. Check that native form validation (`required`, `min`, `max`
  without `novalidate`) doesn't block the submit anyway.
- **Mutation spot-checks catch weak tests.** Reverting a fix with no test
  failing shows the test doesn't do its job. Ask the test-quality reviewer for
  these checks every time.
- **Implement in batches** of about 6–10 commits per agent. That keeps each
  agent's context manageable and gives you checkpoints to push.
