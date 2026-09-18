---
'unvibe': minor
---

Initial release.

`unvibe scan` scores a local directory or any public repo for AI slop across nine
categories and 44 rules, normalized per 1000 code lines into a 0-100 score and an
A-F grade. JavaScript and TypeScript are analysed through the TypeScript AST;
Python, Go, Rust, Ruby, Java, PHP, C# and C/C++ get line-oriented analysis.

`unvibe plan` emits an ordered refactor plan grouped into waves, correctness
first. `unvibe skill install` installs the agent skill into Claude Code,
OpenCode and Codex.

Output as terminal, JSON, markdown or SARIF 2.1.0, with `--max-slop` and
`--max-findings` thresholds for CI gating.
