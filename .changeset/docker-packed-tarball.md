---
"@capsule-sdk/docker": patch
---

The published tarball no longer ships the declarations of the test-only receipt fixture module, and the `runDocker` option and result docs in the declarations are one line each; the full stop semantics (a timeout, deadline or abort kills only the docker CLI, the process in the daemon may keep running) stay in the Docker quickstart and the source. No behaviour change.
