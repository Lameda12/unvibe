/**
 * Single source of truth for the shipped agent skill. `scripts/gen-skill.ts`
 * writes these to `skills/unvibe/` so the repo carries a browsable copy, and CI
 * fails if the two drift.
 */

export const SKILL_MD = `---
name: unvibe
description: Unvibecode a codebase. Use when asked to clean up AI slop, de-slop or unvibe a project, audit the quality of generated code, review a vibe-coded repo, or judge whether a repository was written without review. Works on the current project or any public repo URL. Produces a scored report and works through a prioritized refactor plan.
---

# Unvibe

Take a codebase that was generated faster than it was read, and turn it into
code someone can own. You are not rewriting it. You are finding the places where
nobody made a decision, and making one.

## Run the scan first

Never start by reading files at random. Get the map:

\`\`\`bash
npx unvibe scan .                      # current project
npx unvibe scan owner/repo             # any public repo
npx unvibe scan https://github.com/owner/repo#main
\`\`\`

Useful flags: \`--format json|markdown|sarif\`, \`--verbose\`, \`--min-severity high\`,
\`--ignore comments.*\`, \`--no-git\`, \`--languages python,typescript\`.

For machine-readable output to reason over:

\`\`\`bash
npx unvibe scan . --format json > /tmp/unvibe.json
\`\`\`

Then get the ordered plan:

\`\`\`bash
npx unvibe plan . > UNVIBE.md
\`\`\`

## What the score means

\`slop\` runs 0-100, higher is worse, normalized per 1000 code lines so a large
repo is not punished for being large. Grades: A under 20, B under 35, C under 50,
D under 70, F above. A mature, human-maintained project typically lands at a
high B. Report the grade, but never lead with it: the findings are the product,
the number is just the headline.

## Work the waves in order

The plan groups findings into waves. Follow the order. It exists because
cleaning comments before collapsing duplication means cleaning the same comment
three times, and because a diff that mixes behaviour changes with cosmetics
cannot be reviewed.

1. **Correctness and honesty.** Swallowed errors, stubs that pretend to work,
   tests that cannot fail, placeholder credentials. These change runtime
   behaviour. For each one, write the test that fails against current behaviour
   before you change anything.
2. **Structure and duplication.** Collapse clones, split god files, remove
   passthrough wrappers. Behaviour-preserving only, tests green between steps.
3. **Type safety.** Close \`any\` holes and suppressions, starting at the
   boundaries and letting inference do the interior.
4. **Noise.** Narrated comments, banners, dead imports. One commit, or skip it.

One wave per branch or commit. Run the project's own test and lint commands
between waves, not only at the end.

## Judgement is required

The detectors are heuristics. They are wrong sometimes, and a confidently wrong
finding that you act on is worse than one you skip.

- A \`pass\` in an abstract base class is correct, not a stub.
- A broad \`except\` at a process boundary that logs and exits is correct.
- A wrapper that exists to pin a seam you genuinely swap in tests is correct.
- Test fixtures are allowed to contain fake credentials and \`example.com\`.

When a finding is wrong, say so plainly and move on. Do not silence it by
deleting the code it points at.

## What to do about the findings you cannot fix

Some findings are real but out of scope for the task you were given. Do not
quietly widen the change. List them at the end of your report under
"not addressed", with one line each on why. If the user asked for a cleanup of
one module, clean that module and name the rest.

## Reporting back

Lead with what you changed and what broke. Then:

- the before and after score, if you re-ran the scan;
- findings fixed, grouped by wave;
- findings you judged wrong, and why;
- findings left for later.

Re-run \`unvibe scan\` at the end so the after-number is real and not estimated.

## Gate it in CI

\`\`\`bash
npx unvibe scan . --max-slop 40        # exit 1 when the score exceeds 40
npx unvibe scan . --format sarif > unvibe.sarif
\`\`\`

Exit codes: \`0\` clean, \`1\` threshold exceeded, \`2\` the scan itself failed.
`;

export const RULES_MD = `# Rule catalogue

Every finding carries a dotted rule id. Pass any of these to \`--ignore\`, with
\`category.*\` to silence a whole family.

## comments

| Rule | Severity | Fires on |
|---|---|---|
| \`comments.hedge\` | high | Prose admitting the code is simplified, illustrative or "for now" |
| \`comments.density\` | medium | Comment lines above 40% of code lines in a file |
| \`comments.narration\` | low | "Step 1:", "Now we...", "First, ..." |
| \`comments.obvious\` | low | Restates a keyword: "Return the result", "Loop through" |
| \`comments.redundant\` | low | Every word already appears as an identifier on the next line |
| \`comments.banner\` | info | Decorative \`=====\` section dividers |
| \`comments.emoji\` | info | Emoji-led comments |

## error-handling

| Rule | Severity | Fires on |
|---|---|---|
| \`error-handling.empty-catch\` | high | Catch or except block with no body, or only \`pass\` |
| \`error-handling.swallow-default\` | high | Catch returning null, \`[]\`, \`{}\`, \`0\`, \`''\` or \`false\` |
| \`error-handling.promise-catch-default\` | high | \`.catch(() => null)\` and friends |
| \`error-handling.bare-except\` | high | Python \`except:\` with no type |
| \`error-handling.log-and-continue\` | medium | Catch that only logs, then falls through |
| \`error-handling.broad-except\` | medium | \`except Exception:\` |
| \`error-handling.discarded-error\` | medium | Go error assigned to \`_\` |
| \`error-handling.unwrap-density\` | low/medium | Five or more \`.unwrap()\` in one Rust file |

## placeholders

| Rule | Severity | Fires on |
|---|---|---|
| \`placeholders.not-implemented\` | high | \`NotImplementedError\`, \`todo!()\`, \`throw new Error('not implemented')\` |
| \`placeholders.fake-credential\` | high | \`your-api-key-here\`, \`<YOUR_TOKEN>\`, \`changeme\` |
| \`placeholders.attributed-todo\` | high | \`TODO(claude)\`, \`FIXME(copilot)\` |
| \`placeholders.fake-endpoint\` | medium | \`example.com\` URLs outside tests |
| \`placeholders.todo-stub\` | medium | \`TODO: implement\`, \`FIXME: handle\` |
| \`placeholders.debug-output\` | medium | \`console.log('here')\`, \`print("test")\` |
| \`placeholders.lorem\` | low | Lorem ipsum, John Doe, foo/bar outside tests |

## type-escapes

| Rule | Severity | Fires on |
|---|---|---|
| \`type-escapes.double-assertion\` | medium | \`as unknown as T\` |
| \`type-escapes.ts-suppression\` | low/medium | \`@ts-ignore\`, \`@ts-nocheck\`, unexplained \`@ts-expect-error\` |
| \`type-escapes.any\` | low/medium | Three or more \`any\` / \`Any\` in one file |
| \`type-escapes.catch-any\` | low | \`catch (e: any)\` |
| \`type-escapes.mypy-suppression\` | low | \`# type: ignore\` |
| \`type-escapes.lint-suppression\` | low | \`eslint-disable\` with no stated reason |

## structure

| Rule | Severity | Fires on |
|---|---|---|
| \`structure.passthrough-wrapper\` | medium | Function forwarding its arguments unchanged to one call |
| \`structure.long-function\` | low/medium | Over 60 lines |
| \`structure.complexity\` | low/medium | Over 12 branches |
| \`structure.god-file\` | low/medium | Over 600 lines |
| \`structure.deep-nesting\` | low | Over 4 levels |
| \`structure.parameter-list\` | low | Over 5 parameters |

## duplication

| Rule | Severity | Fires on |
|---|---|---|
| \`duplication.cross-file\` | low/medium | 8+ normalized lines repeated in another file |
| \`duplication.within-file\` | low/medium | The same, inside one file |

## test-theater

| Rule | Severity | Fires on |
|---|---|---|
| \`test-theater.tautology\` | high | \`assert True\`, \`expect(true).toBe(true)\` |
| \`test-theater.no-assertion\` | high | Test body with no assertion |
| \`test-theater.mock-only\` | medium | Only asserts that a mock was called |

## dead-code

| Rule | Severity | Fires on |
|---|---|---|
| \`dead-code.unused-import\` | low | Imported binding never referenced |

## history

Repo-level, anchored to \`.\`. Skipped with \`--no-git\`.

| Rule | Severity | Fires on |
|---|---|---|
| \`history.bulk-commits\` | medium | Over 35% of file changes arriving in 25+ file commits |
| \`history.single-drop\` | medium | Whole codebase in three commits or fewer |
| \`history.churn\` | low | Files rewritten 3+ times within a week of being added |
| \`history.generic-messages\` | info | Over 40% of commit subjects are generic |
`;
