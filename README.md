# unvibe-cli

Point it at a repo. It tells you which parts nobody read.

```bash
npx unvibe-cli scan .
npx unvibe-cli scan expressjs/express
npx unvibe-cli scan https://github.com/owner/repo#main
```

```
  unvibe  https://github.com/expressjs/express
  98 files, 14,574 code lines, scanned in 0.3s

  █████░░░░░░░░░░░░░░░░░░░░░░░  18.7/100 slop  grade A
  Reads like someone owns it.

  BY CATEGORY
    comments          11 findings  1.03/kloc
    duplication       46 findings  0.79/kloc
    error-handling     2 findings  0.69/kloc
    structure          6 findings  0.51/kloc
```

Vibe coding produces code that compiles, passes its tests, and quietly rots:
swallowed errors, stubs that pretend to work, tests that cannot fail, the same
block pasted into four files. unvibe finds those, scores them, and hands you an
ordered plan to fix them. It runs on any local directory or any public repo,
and installs as a skill into Claude Code, OpenCode and Codex so your agent can
drive the cleanup itself.

## Install

```bash
npx unvibe-cli scan .        # no install
npm i -g unvibe-cli      # or globally
```

Node 18+. One runtime dependency (`typescript`, used as a parser).

The package is `unvibe-cli`, not `unvibe`: that name belongs to an unrelated
project on npm.

Running `unvibe-cli` with no arguments prints the banner and the usage summary. The
banner goes to stderr and only when stderr is a terminal, so
`unvibe-cli scan . --format json > report.json` still produces a parseable file.
`--no-banner` turns it off everywhere.

## Commands

```bash
unvibe-cli scan [target]          # score a codebase
unvibe-cli plan [target]          # ordered refactor plan, as markdown
unvibe-cli skill install          # install the agent skill
unvibe-cli skill where            # print the install paths
unvibe-cli rules                  # list every rule id
```

A target is a directory, `owner/repo`, or any git URL with an optional `#ref`.
A path that exists locally always wins, so `unvibe-cli scan .` never touches the
network.

The repository-root `.gitignore` is honoured by default: build output and
vendored code are skipped for the same reason they are not committed. Pass
`--no-gitignore` to scan them anyway.

### Options

| Flag               | Effect                                            |
| ------------------ | ------------------------------------------------- |
| `-f, --format`     | `terminal`, `json`, `markdown`, `sarif`           |
| `-o, --output`     | write to a file instead of stdout                 |
| `-v, --verbose`    | every finding, not just the worst per file        |
| `--min-severity`   | `info`, `low`, `medium`, `high`                   |
| `--ignore`         | rule ids, comma separated, `category.*` supported |
| `--languages`      | restrict, e.g. `python,typescript`                |
| `--exclude`        | extra directory or file names to skip             |
| `--max-slop`       | exit 1 when the score exceeds this                |
| `--max-findings`   | exit 1 when findings exceed this                  |
| `--no-git`         | skip history analysis                             |
| `--no-gitignore`   | scan files the repo's `.gitignore` excludes       |
| `--no-duplication` | skip clone detection                              |
| `--depth`          | clone depth for remote targets                    |
| `--keep-clone`     | leave the clone on disk and print its path        |

Exit codes: `0` clean, `1` threshold exceeded, `2` the scan itself failed.

## The score

`slop` runs 0 to 100, higher is worse. Findings are weighted by severity
(`high` counts twenty times an `info`) and normalized per 1000 code lines, so a
large repo is not punished for being large.

| Grade | Slop     | Means                                   |
| ----- | -------- | --------------------------------------- |
| A     | under 20 | Reads like someone owns it              |
| B     | under 35 | Normal wear                             |
| C     | under 50 | Recognisably generated in places        |
| D     | under 70 | Substantially unreviewed                |
| F     | 70+      | Do not ship without a full read-through |

The curve is anchored so that a healthy human-maintained codebase lands at a
high A or low B. That anchor is a calibration constant, not a measurement: see
`BASELINE_WEIGHT_PER_KLOC` in `src/score.ts` if you want to move it.

**unvibe-cli grades itself a C.** Its detector files carry long, branchy
functions, which it flags, correctly. Tuning the thresholds until it scored an A
would make the number meaningless, so the number stands.

### The score is not yet comparable across languages

This is the honest state of the tool. Measured against mature, heavily reviewed
codebases:

| Repository             | Language   | Grade  |
| ---------------------- | ---------- | ------ |
| `sindresorhus/slugify` | JavaScript | A (13) |
| `expressjs/express`    | JavaScript | A (16) |
| `microsoft/vscode`     | TypeScript | D (68) |
| `psf/requests`         | Python     | D (70) |

Express and slugify are right. VS Code and requests should not be sitting next
to D: those numbers reflect detector density, not code quality. The JS and TS
path uses the TypeScript AST and is precise; the Python path is line-oriented
and fires more often per line, so the same curve punishes it harder. Large
repositories accumulate long functions and duplicated blocks faster than the
per-kloc normalization forgives them.

Treat the grade as meaningful for JavaScript and TypeScript, and the individual
findings as meaningful everywhere. Per-language calibration against a corpus of
known-good repositories is the open work, and it is not a threshold tweak.

## What it looks for

Nine categories, 44 rules. `unvibe-cli rules` lists them all;
[`skills/unvibe/references/rules.md`](skills/unvibe/references/rules.md) has the
full table with severities.

**error-handling** — empty catches, `except: pass`, catches that log and carry
on, catches that return `null` so a network failure looks like an empty result,
`.catch(() => [])`, discarded Go errors, `.unwrap()` density.

**placeholders** — `NotImplementedError`, `throw new Error('not implemented')`,
`your-api-key-here`, `TODO(claude)`, `console.log('here')`.

**test-theater** — `assert True`, tests with no assertion, tests that only prove
a mock was called.

**duplication** — 8+ normalized lines repeated elsewhere, deduplicated so one
clone family reports once per site rather than once per sliding window.

**comments** — prose admitting the code is simplified, "Step 1:" narration,
comments that restate the line below them, `=====` banners.

**type-escapes** — `any` density, `as unknown as T`, unexplained `@ts-ignore`,
`# type: ignore`.

**structure** — long functions, high branch counts, deep nesting, god files,
wrappers that forward their arguments and add nothing.

**dead-code** — unused imports.

**history** — the whole codebase landing in one commit, bulk commits of 25+
files, files rewritten three times in their first week, generic commit subjects.
These describe the repo rather than any line in it, and are skipped with
`--no-git`.

JavaScript and TypeScript are parsed with the TypeScript compiler's AST.
Python, Go, Rust, Ruby, Java, PHP, C# and C/C++ get line-oriented analysis, and
every language gets the comment, placeholder and duplication rules.

## Judgement is required

The detectors are heuristics. A `pass` in an abstract base class is correct. A
broad `except` at a process boundary is correct. A wrapper that pins a seam you
genuinely swap in tests is correct.

unvibe-cli tries hard not to waste your attention. Test files, fixtures,
`examples/` and `docs/` are exempt from the rules that only make sense for
shipped code. JSDoc is API documentation, not narration. Licence headers are a
legal requirement, not decoration. A catch block with a comment in it scores as
a decision rather than a silent swallow. In Python, `except ImportError: pass`
is an optional-dependency probe and says nothing, a narrow `except ValueError:`
scores far below a bare `except:`, `# type: ignore[assignment]` is the
recommended form rather than a finding, and `raise NotImplementedError` in an
abstract method is how the language spells an abstract method.

Every one of those came from a real false positive on a real repository, and
each has a regression test in
[`calibration.test.ts`](src/detectors/calibration.test.ts) and
[`language-calibration.test.ts`](src/detectors/language-calibration.test.ts).

When a finding is still wrong, say so and move on. Do not silence it by deleting
the code it points at.

## Config

`unvibe.config.json` or `.unviberc.json`, read from the scanned directory and
then the working directory:

```json
{
  "ignoreRules": ["comments.*", "structure.long-function"],
  "exclude": ["generated"],
  "languages": ["typescript", "python"],
  "minSeverity": "medium",
  "maxSlop": 40
}
```

Flags override it; lists merge. An unknown key is an error rather than a silent
no-op.

## The agent skill

```bash
npx unvibe-cli skill install                       # all three hosts
npx unvibe-cli skill install --host claude,codex   # pick
npx unvibe-cli skill install --project             # into this repo
```

| Host        | Path                                |
| ----------- | ----------------------------------- |
| Claude Code | `~/.claude/skills/unvibe/`          |
| OpenCode    | `~/.config/opencode/skills/unvibe/` |
| Codex CLI   | `~/.codex/skills/unvibe/`           |

One `SKILL.md` serves all three: they have converged on a directory per skill
holding a `SKILL.md` with `name` and `description` frontmatter, and only the
search paths differ. Codex resolves skills from `CODEX_HOME` only, so
`--project` skips it.

Restart the agent, then ask it to unvibe the project. The skill tells it to scan
first, work the waves in order, and report what it judged wrong rather than
fixing everything the tool says.

The skill is generated from `src/skill/content.ts` into `skills/unvibe/`, and CI
fails if the two drift. You can also just copy that directory out of this repo.

## CI

```bash
npx unvibe-cli scan . --max-slop 40
npx unvibe-cli scan . --format sarif -o unvibe.sarif
```

```yaml
- run: npx unvibe-cli scan . --format sarif -o unvibe.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: unvibe.sarif
```

SARIF 2.1.0, so findings land in the GitHub Security tab with per-line
annotations.

## API

```ts
import { resolveTarget, scan, renderPlan, renderSarif } from 'unvibe-cli';

const target = await resolveTarget('owner/repo');
const report = await scan(target, { skipGit: true });

console.log(report.score.grade, report.score.slop);
console.log(renderPlan(report));
```

Everything is exported: detectors, the scoring functions, every reporter, the
skill installer. Dual ESM and CJS with types.

## Development

```bash
npm install
npm run build
npm test
npm run ci        # skill drift, build, format, exports, typecheck, tests
```

### Releasing

```bash
npm run version                        # changeset version: bump + CHANGELOG
git commit -am "Release v0.2.0"
git push
git tag v0.2.0 && git push --tags      # the tag triggers the publish
```

The release workflow is tag-driven rather than using the changesets
"Version Packages" pull request. That flow needs GitHub Actions to be permitted
to open pull requests, which is off by default and controlled at the
organisation level; tagging needs no special permission. The workflow refuses to
publish when the tag and `package.json` version disagree.

Publishing needs an `NPM_TOKEN` repository secret. If you would rather have the
changesets PR flow back, enable it under
Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to
create and approve pull requests", and restore `changesets/action` in
`.github/workflows/release.yml`.

Built on [Matt Pocock's npm package template](https://github.com/mattpocock/tt-package-demo):
`tsup` for dual ESM/CJS, `tsc` as the linter, `vitest`, `prettier`,
`@arethetypeswrong/cli`, changesets.

## Known limitations

- The grade is calibrated for JavaScript and TypeScript only. See above.
- Scanning is single-threaded: 3.1M lines of VS Code takes about six minutes,
  and progress only prints with `--verbose`.
- A 3M-line repository produces a 37MB JSON report. There is no findings cap.
- Duplication matches normalized text, so a clone that was renamed throughout
  is missed.
- No autofix, and no baseline file, so there is no way to ratchet an existing
  repository rather than facing every finding at once.
- Private repositories are not supported; clones run with credential prompts
  disabled.
- The OpenCode and Codex skill paths come from their documentation and have not
  been verified against a live install.
- Only nested `.gitignore` files at the repository root are read, and Windows is
  untested.

## Prior art

[aislop](https://github.com/scanaislop) is the most complete tool in this space:
50+ rules across eight languages, distributed through npm, Homebrew and PyPI,
with agent skills for several hosts. If you want the broadest ruleset today,
start there.

[slop-scan](https://github.com/benvinegar/slop-scan) covers TypeScript and
JavaScript with nine error-handling rules and a benchmark set.
[ai-slop-detector](https://pypi.org/project/ai-slop-detector/) does
evidence-based static analysis, Python first.

What this one does differently: it scans a public repository straight from a
URL without cloning it yourself, folds git history into the score, and emits an
ordered refactor plan grouped into waves rather than a flat finding list.

## License

MIT
