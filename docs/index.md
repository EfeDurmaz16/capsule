# Capsule Documentation

Start with the [README](https://github.com/EfeDurmaz16/capsule#readme) for the pitch, quickstart, and provider matrix. This index maps the full documentation set.

## Concepts

- [Architecture](architecture.md): packages, the governed operation path, runtime domains, and source diagrams
- [Manifesto](manifesto.md): why a domain-aware adapter layer instead of a universal cloud abstraction
- [Capability model](capability-model.md): support levels, capability negotiation, and provider selection
- [Policy model](policy-model.md): checks that run before every runtime action
- [Execution receipts](execution-receipts.md): what receipts record and what they prove
- [Log normalization](log-normalization.md): how each provider's raw logs map into a single LogEntry shape
- [Artifacts](artifacts.md): hashing, manifests, and the filesystem collector
- [Security model](security-model.md)
- [Comparison](comparison.md): Capsule against provider SDKs, IaC, frameworks, and ComputeSDK

## Domain References

- [Domains](domains.md): sandbox, jobs and services, edge, database resources, and machines
- [Preview environments](preview-environments.md)

## Using Capsule

- [Operations guide](operations-guide.md): the CLI surface, task by task
- [Real provider quickstarts](real-provider-quickstarts.md)
- [Real orchestration walkthrough](real-orchestration-walkthrough.md): Neon plus Vercel plus Cloud Run preview end to end
- [Provider matrix](provider-matrix.md) (generated)
- [AI framework wrappers](ai-framework-wrappers.md)

## Extending Capsule

- [Adapter contract](adapter-contract.md)
- [Adding a provider adapter](adding-provider-adapter.md)
- [Contributing](contributing.md) and [issue labels](issue-labels.md)
- [Live provider tests](live-tests.md)

## Project Records

- [API reference](api-reference.md) (generated)
- [Technical decisions](technical-decisions.md) and [ADRs](adr/README.md)
- [Roadmap](roadmap.md)
- [Release operations](release-rollback.md): publish readiness and rollback
