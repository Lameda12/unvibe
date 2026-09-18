---
'unvibe-cli': patch
---

Make the release workflow tag-driven.

The changesets "Version Packages" pull request flow needs GitHub Actions to be
permitted to create pull requests, which is off by default and controlled at the
organisation level, so the workflow failed with a 403. Releases now trigger on a
`v*` tag, which needs no special permission, and the workflow refuses to publish
when the tag and `package.json` version disagree.
