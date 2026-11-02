---
"@capsule-sdk/docker": patch
---

Captured exec and job output is decoded with a `StringDecoder`, as before output bounds existed, instead of a streaming `TextDecoder`. A leading UTF-8 byte order mark in the output is kept again, and decoding is faster; the byte cap, truncation and redaction are unchanged.
