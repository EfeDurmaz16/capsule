---
"@capsule-sdk/cli": patch
---

The `capsule` command now runs when node starts it through a symlink, which is how npm links package bins on macOS and Linux and how paths under `/tmp` resolve on macOS. It compared `process.argv[1]` with the module URL as strings, so started through a link it exited 0 without running any command. Both paths are now resolved before comparing.
