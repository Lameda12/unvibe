---
'unvibe-cli': minor
---

Rename the package to `unvibe-cli`, and calibrate the analyzer against Python
and large repositories.

`unvibe` on npm is an unrelated project, so the published name is now
`unvibe-cli` and the binary matches. The previous README told people to run
`npx unvibe`, which would have fetched that other package.

Calibration: `psf/requests` graded F and VS Code produced 66,000 findings, of
which 26,000 came from its licence header. Licence headers, encoding pragmas and
`docs/` are now exempt. Python `except` blocks are scored by how specific the
caught exception is, so `except ImportError: pass` says nothing while a bare
`except:` still scores high; a narrowed `# type: ignore[assignment]` is the
recommended form rather than a finding; `raise NotImplementedError` in an
abstract method is not a stub; pytest and unittest idioms count as assertions.

Two real bugs fixed along the way: `blankStrings` did not skip comments, so an
apostrophe in a comment opened a string that blanked the rest of the file and
hid every assertion below it; and block extent stopped at a wrapped function
signature, truncating the body.

The repository-root `.gitignore` is now honoured by default, with
`--no-gitignore` to opt out.
