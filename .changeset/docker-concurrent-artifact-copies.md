---
"@capsule-sdk/docker": patch
---

Sandbox artifact collection copies requested paths that do not lie inside each other with up to four `docker cp` calls at a time instead of one after another. It is still one `docker cp` per path with the same arguments, and the artifact layout, selection and hashes are unchanged. Paths nested inside another requested path are still copied one by one in request order. After a failed copy no further copy starts, running copies finish before the temporary directory is removed, and the error of the earliest failed path is raised, as before.
