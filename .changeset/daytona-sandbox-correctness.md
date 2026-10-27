---
"@capsule-sdk/daytona": minor
---

Daytona sandbox correctness fixes.

- `listFiles(path)` now builds each entry path from the requested directory and the SDK `FileInfo.name` (the installed SDK returns no path field), so `/workspace/build` lists `/workspace/build/out.txt` and relative `build` lists `build/out.txt`. Entry types come from `FileInfo.isDir`.
