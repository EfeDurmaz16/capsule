# Capsule Documentation

Start with the [README](https://github.com/EfeDurmaz16/capsule#readme) for the pitch, quickstart, and provider matrix. This index maps the full documentation set.

## Concepts

- [Architecture](architecture.md) and [architecture diagrams](architecture-diagrams.md)
- [Manifesto](manifesto.md): why a domain-aware adapter layer instead of a universal cloud abstraction
- [Primitive taxonomy](primitive-taxonomy.md): how the seven runtime domains are carved
- [Capability model](capability-model.md): support levels and capability negotiation
- [Policy model](policy-model.md): checks that run before every runtime action
- [Execution receipts](execution-receipts.md): what receipts record and what they prove
- [Security model](security-model.md)
- [Comparison](comparison.md): Capsule against provider SDKs, IaC, frameworks, and ComputeSDK

## Domain References

- [Sandbox model](sandbox-model.md)
- [Deployment model](deployment-model.md)
- [Edge model](edge-model.md)
- [Database resource model](database-resource-model.md)
- [Machine model](machine-model.md)
- [Preview environments](preview-environments.md)

## Using Capsule

- [Operations guide](operations-guide.md): the CLI surface, task by task
- [Real provider quickstarts](real-provider-quickstarts.md)
- [Real orchestration walkthrough](real-orchestration-walkthrough.md): Neon plus Vercel plus Cloud Run preview end to end
- [Provider matrix](provider-matrix.md) (generated) and [provider selection](provider-selection.md)
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
- [Real provider gap register](real-provider-gap-register.md)
- [Release rollback runbook](release-rollback.md) and [release notes template](release-notes-template.md)
- [Publish readiness](publish-readiness.md) and [unfinished marker gate](unfinished-marker-gate.md)
