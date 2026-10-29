---
"@capsule-sdk/ecs": patch
---

The error-classifying ECS client wrapper now forwards every argument of `send`, including the request options. It previously passed only the command, so the `abortSignal` of a `service.delete` observation never reached the AWS SDK and an expired or cancelled DescribeServices request kept running in the background. Provider errors are still classified the same way.
