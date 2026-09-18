---
'unvibe': patch
---

Add a startup banner and make a bare `unvibe` invocation self-explanatory.

`unvibe` with no arguments now prints the banner and usage instead of silently
scanning the working directory. The banner is written to stderr and only when
stderr is a terminal, so machine-readable output stays parseable when piped or
redirected. Colour follows the stream the banner is written to rather than
always checking stderr, and `--no-banner` suppresses it.
