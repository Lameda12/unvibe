# Rule catalogue

Every finding carries a dotted rule id. Pass any of these to `--ignore`, with
`category.*` to silence a whole family.

## comments

| Rule | Severity | Fires on |
|---|---|---|
| `comments.hedge` | high | Prose admitting the code is simplified, illustrative or "for now" |
| `comments.density` | medium | Comment lines above 40% of code lines in a file |
| `comments.narration` | low | "Step 1:", "Now we...", "First, ..." |
| `comments.obvious` | low | Restates a keyword: "Return the result", "Loop through" |
| `comments.redundant` | low | Every word already appears as an identifier on the next line |
| `comments.banner` | info | Decorative `=====` section dividers |
| `comments.emoji` | info | Emoji-led comments |

## error-handling

| Rule | Severity | Fires on |
|---|---|---|
| `error-handling.empty-catch` | high | Catch or except block with no body, or only `pass` |
| `error-handling.swallow-default` | high | Catch returning null, `[]`, `{}`, `0`, `''` or `false` |
| `error-handling.promise-catch-default` | high | `.catch(() => null)` and friends |
| `error-handling.bare-except` | high | Python `except:` with no type |
| `error-handling.log-and-continue` | medium | Catch that only logs, then falls through |
| `error-handling.broad-except` | medium | `except Exception:` |
| `error-handling.discarded-error` | medium | Go error assigned to `_` |
| `error-handling.unwrap-density` | low/medium | Five or more `.unwrap()` in one Rust file |

## placeholders

| Rule | Severity | Fires on |
|---|---|---|
| `placeholders.not-implemented` | high | `NotImplementedError`, `todo!()`, `throw new Error('not implemented')` |
| `placeholders.fake-credential` | high | `your-api-key-here`, `<YOUR_TOKEN>`, `changeme` |
| `placeholders.attributed-todo` | high | `TODO(claude)`, `FIXME(copilot)` |
| `placeholders.fake-endpoint` | medium | `example.com` URLs outside tests |
| `placeholders.todo-stub` | medium | `TODO: implement`, `FIXME: handle` |
| `placeholders.debug-output` | medium | `console.log('here')`, `print("test")` |
| `placeholders.lorem` | low | Lorem ipsum, John Doe, foo/bar outside tests |

## type-escapes

| Rule | Severity | Fires on |
|---|---|---|
| `type-escapes.double-assertion` | medium | `as unknown as T` |
| `type-escapes.ts-suppression` | low/medium | `@ts-ignore`, `@ts-nocheck`, unexplained `@ts-expect-error` |
| `type-escapes.any` | low/medium | Three or more `any` / `Any` in one file |
| `type-escapes.catch-any` | low | `catch (e: any)` |
| `type-escapes.mypy-suppression` | low | `# type: ignore` |
| `type-escapes.lint-suppression` | low | `eslint-disable` with no stated reason |

## structure

| Rule | Severity | Fires on |
|---|---|---|
| `structure.passthrough-wrapper` | medium | Function forwarding its arguments unchanged to one call |
| `structure.long-function` | low/medium | Over 60 lines |
| `structure.complexity` | low/medium | Over 12 branches |
| `structure.god-file` | low/medium | Over 600 lines |
| `structure.deep-nesting` | low | Over 4 levels |
| `structure.parameter-list` | low | Over 5 parameters |

## duplication

| Rule | Severity | Fires on |
|---|---|---|
| `duplication.cross-file` | low/medium | 8+ normalized lines repeated in another file |
| `duplication.within-file` | low/medium | The same, inside one file |

## test-theater

| Rule | Severity | Fires on |
|---|---|---|
| `test-theater.tautology` | high | `assert True`, `expect(true).toBe(true)` |
| `test-theater.no-assertion` | high | Test body with no assertion |
| `test-theater.mock-only` | medium | Only asserts that a mock was called |

## dead-code

| Rule | Severity | Fires on |
|---|---|---|
| `dead-code.unused-import` | low | Imported binding never referenced |

## history

Repo-level, anchored to `.`. Skipped with `--no-git`.

| Rule | Severity | Fires on |
|---|---|---|
| `history.bulk-commits` | medium | Over 35% of file changes arriving in 25+ file commits |
| `history.single-drop` | medium | Whole codebase in three commits or fewer |
| `history.churn` | low | Files rewritten 3+ times within a week of being added |
| `history.generic-messages` | info | Over 40% of commit subjects are generic |
