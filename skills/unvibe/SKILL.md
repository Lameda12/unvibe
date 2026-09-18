---
name: unvibe
description: Unvibecode a codebase. Use when asked to clean up AI slop, de-slop or unvibe a project, audit the quality of generated code, review a vibe-coded repo, or judge whether a repository was written without review. Works on the current project or any public repo URL. Produces a scored report and works through a prioritized refactor plan.
---

# Unvibe

Take a codebase that was generated faster than it was read, and turn it into
code someone can own. You are not rewriting it. You are finding the places where
nobody made a decision, and making one.

## Run the scan first

Never start by reading files at random. Get the map:

```bash
npx unvibe-cli scan .                      # current project
npx unvibe-cli scan owner/repo             # any public repo
npx unvibe-cli scan https://github.com/owner/repo#main
```

Useful flags: `--format json|markdown|sarif`, `--verbose`, `--min-severity high`,
`--ignore comments.*`, `--no-git`, `--languages python,typescript`.

For machine-readable output to reason over:

```bash
npx unvibe-cli scan . --format json > /tmp/unvibe.json
```

Then get the ordered plan:

```bash
npx unvibe-cli plan . > UNVIBE.md
```

## What the score means

`slop` runs 0-100, higher is worse, normalized per 1000 code lines so a large
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
3. **Type safety.** Close `any` holes and suppressions, starting at the
   boundaries and letting inference do the interior.
4. **Noise.** Narrated comments, banners, dead imports. One commit, or skip it.

One wave per branch or commit. Run the project's own test and lint commands
between waves, not only at the end.

## Judgement is required

The detectors are heuristics. They are wrong sometimes, and a confidently wrong
finding that you act on is worse than one you skip.

- A `pass` in an abstract base class is correct, not a stub.
- A broad `except` at a process boundary that logs and exits is correct.
- A wrapper that exists to pin a seam you genuinely swap in tests is correct.
- Test fixtures are allowed to contain fake credentials and `example.com`.

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

Re-run `unvibe-cli scan` at the end so the after-number is real and not estimated.

## Gate it in CI

```bash
npx unvibe-cli scan . --max-slop 40        # exit 1 when the score exceeds 40
npx unvibe-cli scan . --format sarif > unvibe.sarif
```

Exit codes: `0` clean, `1` threshold exceeded, `2` the scan itself failed.
