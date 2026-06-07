# Guardrail: Architecture Slop

**Severity:** High (unjustified complexity has compounding cost)
**Category:** Architecture quality

## Pattern

Architecture decisions that sound sophisticated but don't match actual requirements. Buzzword-driven design. Complexity assumed rather than earned.

## Detection Rules

- Does the proposed architecture match the actual scale? (10 users don't need microservices)
- Is the complexity justified by a specific requirement, or just "best practice"?
- Could a simpler approach work? If yes, why isn't it the recommendation?
- Are buzzwords being used as reasoning? ("event-driven" is not a reason, it's a pattern)
- Is the "future-proofing" based on concrete plans or speculation?

## Examples

### Slop

```
"We should use an event-driven microservices architecture with CQRS
and event sourcing" (for a CRUD app with 3 endpoints and 100 users)

"Let's implement a service mesh with circuit breakers and distributed
tracing" (for a monolith on a single server)

"We need a Kafka cluster for message passing" (for 10 events per minute)

"Let's use GraphQL for maximum flexibility" (for 5 fixed queries)
```

### Not Slop

```
"A monolith with 3 REST endpoints is sufficient. We'll extract
services if/when we need independent scaling or deployment."

"PostgreSQL handles our query patterns well. We'll add read replicas
if/when we exceed 10k queries per second."

"A simple task queue (Redis + BullMQ) handles our async processing.
We'll move to Kafka if/when we need multi-consumer event streaming."

"REST with OpenAPI spec. GraphQL adds complexity we don't need for
our fixed client requirements."
```

## The Challenge Test

For every architectural component, ask: **"What breaks if we don't have this?"**

- If the answer is "nothing for the next 6 months" → remove it
- If the answer is "we'd need to add it in 2 months when X happens" → document the upgrade path, don't build it now
- If the answer is "users can't complete the core flow" → keep it

## Fix

Start with the simplest architecture that meets current requirements. Document the concrete triggers that would justify more complexity. "We'll add caching when p99 latency exceeds 500ms" is better than "we're adding Redis for performance."
