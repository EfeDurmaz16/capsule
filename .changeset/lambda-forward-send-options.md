---
"@capsule-sdk/lambda": patch
---

The error-classifying client wrapper now forwards every `send()` argument to the injected or default Lambda client, as the ECS adapter does. Before, only the command was forwarded, so an options argument such as an SDK `abortSignal` never reached the client. The injected client type accepts the options argument.
