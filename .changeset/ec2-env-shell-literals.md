---
"@capsule-sdk/ec2": minor
---

`machine.create` now exports each `env` entry in the generated user-data script as a POSIX single-quoted literal, so dollars, backticks, quotes and newlines are preserved instead of being expanded by the shell that runs user data. Env names that are not valid shell identifiers (`[A-Za-z_][A-Za-z0-9_]*`) and values containing NUL are rejected before any AWS request. The receipt now states that these exports exist only inside the user-data script process and do not persist into later logins, services or runner processes, and that adapter `userData` replaces the generated script so `spec.env` is not delivered. An empty `env` no longer produces a script.
