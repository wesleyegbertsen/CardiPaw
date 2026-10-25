export const meta = {
  name: 'test-coverage-pipeline',
  description:
    'Find missing tests, plan in 3 refining passes, implement, review from 4 angles, fix, and validate coverage',
  whenToUse:
    'Adding missing tests (and fixing the bugs they expose) across a codebase or a scope such as "components and views". Invoked by the test-coverage-pipeline skill.',
  phases: [
    { title: 'Analyze', detail: '3 independent gap analyses, each from a different angle' },
    { title: 'Report', detail: 'merge the analyses into one prioritized report' },
    { title: 'Plan', detail: '3 sequential planning passes, each refining the previous' },
    { title: 'Implement', detail: 'one agent per commit batch, sequential, each commit green' },
    { title: 'Review', detail: '4 reviewers with different angles' },
    { title: 'Fix', detail: 'triage the review findings, then implement the fix plan' },
    { title: 'Validate', detail: 'measure coverage, fill the significant gaps once' },
  ],
};

// ---------------------------------------------------------------------------
// Inputs (all optional):
//   scope           what to cover, e.g. "the whole codebase" or "components and views"
//   commitTrailer   lines to end every commit message with (the session's attribution lines)
//   baseRef         git ref the work starts from; reviews diff against it (default: HEAD at start)
//   context         anything else agents should know (earlier rounds, deferred items, conventions)
//   analysisAngles  override the 3 analysis angles (array of strings)
//   reviewAngles    override the review angles (array of strings, at least 3)
// Agents commit locally on the current branch. Pushing and PRs are left to the caller.
// ---------------------------------------------------------------------------

const A = args || {};
const scope = A.scope || 'the whole codebase';
const trailer = A.commitTrailer
  ? `End every commit message with these lines, after a blank line:\n${A.commitTrailer}`
  : "Follow the repository's commit-message conventions.";
const context = A.context ? `\nContext from the caller:\n${A.context}\n` : '';

const BASE_RULES = `
Rules for every agent in this pipeline:
- Learn the repo first: its README/CLAUDE.md, package scripts or build files, the CI workflow (which commands must pass), the existing tests and test helpers, and their conventions.
- Cite file:line for every claim, and check claims against the actual source.
- Never skip, disable or weaken a test to get green.`;

const WRITE_RULES = `
- Work on the CURRENT git branch. Do NOT push, and do NOT open or edit pull requests.
- One commit per work item with a conventional message (type(scope): description). Before EACH commit run every check CI runs (lint, typecheck, tests, and any extra checks such as locale or build) and make sure each exit code is zero; never let a pipe hide a failure.
- ${trailer}
- For every bug fix: write the regression test first, run it and see it FAIL, then fix and see it pass. Report which ones you confirmed.
- Match the surrounding code style and comment density. Run the formatter's check only on NEW files when existing files are not fully formatted; never reformat existing files wholesale.
- Any new user-visible string goes into every locale/translation file the repo has.
- If a plan detail turns out wrong against the code, do the minimal correct thing and record the deviation.`;

const ANALYSIS_ANGLES = A.analysisAngles || [
  'pure logic and the data layer first: utilities, services, stores, composables or hooks, routing, i18n',
  'UI components, views and user flows: rendering conditions, events, forms, navigation, keyboard and a11y behaviour, store integration',
  'risk-based: anything that can lose or corrupt user data, show wrong numbers, or open a security hole (untrusted input, sanitizers, import/export, timezones); also assess gaps in the EXISTING tests',
];

const REVIEW_ANGLES = A.reviewAngles || [
  'correctness of the production-code changes: behaviour preserved except the intended fixes, edge cases, lifecycle and race conditions; compare against the base with git show <base>:<path>',
  "test effectiveness and robustness: run the suite several times, shuffled (--sequence.shuffle or the runner's equivalent) and under another pool or TZ if relevant; revert 4-6 of the fixes one at a time and confirm a test fails (restore files with git checkout -- <file> and leave git status clean); look for tautologies, over-mocking, timing waits, leaked globals",
  'accessibility, UX and i18n of any UI changes: alerts announced, labels wired to visible text, disabled buttons explained, wording and tone consistent per language',
  'maintainability, security and CI fit: test-infra factoring and duplication, type safety, dependency and lockfile changes, bundle or CI impact, conventional and bisectable commit history',
];

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'number' },
          issue: { type: 'string' },
          scenario: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'file', 'issue', 'fix'],
      },
    },
  },
  required: ['summary', 'findings'],
};

const FINAL_PLAN = {
  type: 'object',
  properties: {
    plan: { type: 'string', description: 'The complete final plan as markdown' },
    batches: {
      type: 'array',
      description:
        'The commit sequence split into 1-3 implementation batches of about 6-10 commits each, in order',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          commits: {
            type: 'string',
            description: 'The plan items/commit subjects this batch covers',
          },
        },
        required: ['title', 'commits'],
      },
    },
    deferred: { type: 'array', items: { type: 'string' } },
  },
  required: ['plan', 'batches', 'deferred'],
};

// --- Phase 1: three independent analyses (barrier: the report needs all of them) ---
phase('Analyze');
const base =
  A.baseRef ||
  (
    await agent(
      'Print the output of `git rev-parse HEAD` in the current repository and nothing else.',
      { label: 'base ref', phase: 'Analyze', effort: 'low' },
    )
  ).trim();
log(`Scope: ${scope}. Base: ${base}`);

const analyses = (
  await parallel(
    ANALYSIS_ANGLES.map(
      (angle, i) => () =>
        agent(
          `READ-ONLY analysis: do not modify repository files (you may run the test suite and small experiments in a temp dir).
Find the MISSING TESTS in ${scope}. Your angle: ${angle}.
For each file or area: what behaviour is untested, concrete test cases (inputs → expected outputs, edge cases), how to isolate heavy dependencies, feasibility, and a priority (high/medium/low) with a one-line risk justification. Also list real bugs you spot while reading (verify cheaply where you can).
${context}${BASE_RULES}
Return concise structured markdown, at most 1200 words.`,
          { label: `analysis ${i + 1}`, phase: 'Analyze', agentType: 'general-purpose' },
        ),
    ),
  )
).filter(Boolean);
if (!analyses.length) throw new Error('All analysis agents failed');

// --- Phase 2: consolidated report ---
phase('Report');
const report = await agent(
  `Merge these ${analyses.length} independent missing-test analyses of ${scope} into ONE consolidated report:
- a bug table (id, bug, where, which analyses found it), confirmed against the source;
- missing tests grouped HIGH / MEDIUM / LOW, de-duplicated, with consensus noted;
- infrastructure notes (helpers, mocking approach, environment pitfalls).
Do not modify files. At most 1500 words of markdown.

${analyses.map((a, i) => `## Analysis ${i + 1}\n${a}`).join('\n\n')}`,
  { label: 'consolidated report', phase: 'Report' },
);

// --- Phase 3: three planning passes, each refining the last ---
phase('Plan');
const SCOPE_GUIDANCE = `Scope guidance: tests are the goal. Plan a minimal fix plus regression test for small, clear-cut, user-impacting bugs the tests expose; defer broad behavioural or markup changes (list them). Refactor only where needed to make logic testable, keeping behaviour identical apart from the fixes. Each commit must leave the repo green.`;

const plan1 = await agent(
  `PLANNING PASS 1 of 3 (the next passes refine your output). Do not edit repository files.
Using the report below, verified against the source, write an implementation plan for adding the missing tests in ${scope}.
${SCOPE_GUIDANCE}
Include test infrastructure (helpers, environment, mocks), an ordered list of conventional commits, the files and test cases per commit, the intended code for each fix, and risks.
${context}${BASE_RULES}
At most 1800 words.

# Report
${report}`,
  { label: 'plan pass 1', phase: 'Plan', agentType: 'Plan' },
);

const plan2 = await agent(
  `PLANNING PASS 2 of 3. Do not edit repository files; you MAY prototype in a temp directory outside the repo (e.g. a test-runner config whose root points at the repo).
Critically refine the plan below against the ACTUAL source:
1. Verify every assumption (names, signatures, exports, environment behaviour of the test DOM/runner) and prototype the riskiest infrastructure.
2. Find tests that would not actually fail before their fix, fixes that change more than intended, and mocking/timer/timezone/module-state pitfalls.
3. Give the exact code for each fix and confirm the regression test fails before and passes after where cheap.
4. Trim low-value or duplicate tests (including duplicates of tests that already exist), and fix the order so every commit stays green.
5. Note project conventions (formatter, linter, typecheck coverage of test files, test naming).
Output the revised FULL plan with a short "Changes vs pass 1" section at the top. At most 2000 words.
${context}
# Report
${report}

# Plan pass 1
${plan1}`,
  { label: 'plan pass 2', phase: 'Plan', agentType: 'general-purpose' },
);

const finalPlan = await agent(
  `PLANNING PASS 3 of 3: the final, implementation-ready plan. Do not edit repository files; experiments only in a temp directory.
Stress-test pass 2: spot-check its riskiest unverified claims, look for anything it missed (other callers of moved code, typecheck/lint coverage of new test files, dependency compatibility), and decide any open questions with a one-line justification.
Then produce the final plan: the commit sequence with conventional messages, exact code for every fix, exact new strings per locale, test cases per commit, and a Definition of Done (every CI check, an alternate-timezone or shuffled run where relevant, formatter check on new files, and a manual UI check list for any fixed UI bug).
Split the commit sequence into 1-3 implementation batches of roughly 6-10 commits, in order.
${context}
# Report
${report}

# Plan pass 2
${plan2}`,
  { label: 'plan pass 3', phase: 'Plan', agentType: 'general-purpose', schema: FINAL_PLAN },
);

// --- Phase 4: implement, one batch at a time (sequential: they share the working tree) ---
phase('Implement');
const implReports = [];
for (const [i, batch] of finalPlan.batches.entries()) {
  const done = implReports.map((r, j) => `Batch ${j + 1} report:\n${r}`).join('\n\n');
  const r = await agent(
    `Implement ONLY batch ${i + 1} of ${finalPlan.batches.length} ("${batch.title}") of the final plan below: ${batch.commits}
Earlier batches are already committed; build on their helpers. Stop after this batch.
${WRITE_RULES}
${BASE_RULES}
${done ? `\n# Reports from earlier batches\n${done}\n` : ''}
# Final plan
${finalPlan.plan}

Report at most 500 words: commits (hash + subject), test count before/after, red→green confirmations, deviations, anything doubtful or left over.`,
    { label: `implement batch ${i + 1}`, phase: 'Implement', agentType: 'general-purpose' },
  );
  if (!r) throw new Error(`Implementation batch ${i + 1} failed; resume after fixing`);
  implReports.push(r);
}

// --- Phase 5: reviews from distinct angles (barrier: the fix plan needs all findings) ---
phase('Review');
const reviews = (
  await parallel(
    REVIEW_ANGLES.map(
      (angle, i) => () =>
        agent(
          `Code review of the work on this branch since ${base} (git diff ${base}..HEAD, git log ${base}..HEAD). READ-ONLY for the repository: experiments only in a temp directory, and if you must touch a repo file to test a mutation, restore it with git checkout -- <file> and leave git status clean.
Your angle: ${angle}.
Report only real issues with a concrete failure scenario and a suggested fix; ranked by severity. Note what you checked and found correct in the summary.
${BASE_RULES}`,
          {
            label: `review ${i + 1}`,
            phase: 'Review',
            agentType: 'general-purpose',
            schema: FINDINGS,
          },
        ),
    ),
  )
).filter(Boolean);
const findings = reviews.flatMap((r) => r.findings);
log(`${findings.length} review findings from ${reviews.length} reviewers`);

// --- Phase 6: triage and fix ---
phase('Fix');
let fixPlan = 'No review findings.';
let fixReport = 'Nothing to fix.';
if (findings.length) {
  fixPlan = await agent(
    `Turn these combined review findings into a fix plan. Verify each claim against the code first (reviewers can be wrong; note any you reject and why). Split into "Fix now" (production fixes with regression tests, then test hardening) and "Deferred" with a reason each. Do not edit files. At most 1000 words.

# Review summaries
${reviews.map((r, i) => `Reviewer ${i + 1}: ${r.summary}`).join('\n')}

# Findings
${JSON.stringify(findings, null, 1)}`,
    { label: 'fix plan', phase: 'Fix' },
  );
  fixReport = await agent(
    `Implement the "Fix now" items of this fix plan, grouped into a few logical conventional commits.
${WRITE_RULES}
${BASE_RULES}
Finish with a full run of every CI check plus a shuffled test run.

# Fix plan
${fixPlan}

Report at most 400 words: commits, test count, red→green confirmations, deviations.`,
    { label: 'implement fixes', phase: 'Fix', agentType: 'general-purpose' },
  );
}

// --- Phase 7: validate coverage, one gap-filling round ---
phase('Validate');
const validation = await agent(
  `Final validation of test coverage for ${scope}. Measure coverage with the project's runner (for vitest: install @vitest/coverage-v8 matching the vitest version with --no-save so package files do not change; for other stacks use the standard tool without adding it to the manifest). Report per-area numbers, then judge whether coverage is good and sufficient. If a user-facing area that holds real logic is still largely untested and cheap to cover, add those tests now (same commit rules), otherwise list the gaps. Do not change package manifests or lockfiles for coverage tooling.
${WRITE_RULES}
${BASE_RULES}
Report at most 400 words: coverage table before/after, tests added (commit hash), remaining gaps and why they are acceptable.`,
  { label: 'coverage validation', phase: 'Validate', agentType: 'general-purpose' },
);

return {
  base,
  scope,
  report,
  plans: { pass1: plan1, pass2: plan2, final: finalPlan.plan },
  deferred: finalPlan.deferred,
  implementation: implReports,
  reviews: reviews.map((r) => r.summary),
  findings,
  fixPlan,
  fixReport,
  validation,
};
