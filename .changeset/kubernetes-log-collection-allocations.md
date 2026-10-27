---
"@capsule-sdk/kubernetes": patch
---

Pod log collection keeps the newest entries with one sort per window of kept entries instead of one sort per source, parses the kubelet's UTC timestamps without regular expression matches, redacts only the env values that occur in a line, and counts UTF-8 bytes without encoding copies. The result, ordering, redaction and truncation are unchanged.
