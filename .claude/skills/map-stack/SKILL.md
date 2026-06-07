---
name: map-stack
description: >
  Map an entire tech stack across multiple codebases/services. Shows how services 
  relate — API calls, shared databases, message queues, shared libraries, deployment 
  topology. Use when you need to understand how multiple repos/services fit together.
argument-hint: "[parent-directory-or-service-list]"
user-invocable: true
context: fork
agent: cartographer
model: claude-opus-4-6
effort: max
allowed-tools:
  - Read(*)
  - Grep(*)
  - Glob(*)
  - Bash(graphify *)
  - Bash(repomix *)
  - Bash(find *)
  - Bash(git *)
  - Bash(wc *)
  - Bash(head *)
  - Bash(ls *)
  - Bash(cat *)
---

## Target

$ARGUMENTS

If no target specified, scan the current directory for subdirectories that look like services (contain package.json, pom.xml, go.mod, Cargo.toml, requirements.txt, Dockerfile, etc.).

## Mode: Multi-Codebase Stack Mapping

This is NOT a single-repo mapping. You are mapping an entire tech stack — multiple services, how they connect, and the system-level architecture.

## Project context

!`cat CLAUDE.md 2>/dev/null || echo "No CLAUDE.md found"`

## Prior codebase maps (from /map-codebase runs)

!`cat uv-out/map-codebase.md 2>/dev/null | head -80 || echo "No prior codebase map — will scan from scratch"`

## Discover services

```!
find . -maxdepth 3 \( -name "package.json" -o -name "pom.xml" -o -name "go.mod" -o -name "Cargo.toml" -o -name "requirements.txt" -o -name "setup.py" -o -name "pyproject.toml" \) -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -30
```

## Dockerfiles and compose

```!
find . -maxdepth 3 \( -name "Dockerfile" -o -name "docker-compose*" \) -not -path "*/node_modules/*" 2>/dev/null | head -20
```

## Infrastructure (Helm, Terraform, K8s)

```!
find . -maxdepth 4 \( -name "*.tf" -o -name "Chart.yaml" -o -name "values.yaml" -o -name "*.k8s.yaml" -o -name "kustomization.yaml" \) -not -path "*/node_modules/*" 2>/dev/null | head -20
```

## API contracts (OpenAPI, gRPC, GraphQL)

```!
find . -maxdepth 4 \( -name "*.proto" -o -name "openapi*" -o -name "swagger*" -o -name "*.graphql" -o -name "schema.graphql" \) -not -path "*/node_modules/*" 2>/dev/null | head -20
```

## Process

Follow this sequence:

### 1. Inventory every service
For each directory that contains a build file, identify:
- Service name
- Language / framework
- What it does (from README, main entry point, or package description)
- How it's deployed (Docker, K8s, serverless)

### 2. Map connections BETWEEN services
This is the hard part. Look for:
- **HTTP/REST calls** — grep for base URLs, API client configs, fetch/axios calls referencing other services
- **gRPC/Protobuf** — shared .proto files, client stubs
- **Message queues** — Kafka topics, RabbitMQ queues, SQS queues referenced across services
- **Shared databases** — same DB connection strings or schema references across services
- **Shared libraries** — internal packages imported by multiple services
- **Environment variables** — service URLs configured via env vars (SERVICE_A_URL, etc.)

### 3. Identify the data flow
- Where does data enter the system? (API gateway, webhook, user upload)
- How does it flow through services?
- Where does it end up? (database, external API, user response)

### 4. Produce the stack map

Output a **System Architecture Diagram** (Mermaid) showing:
- Every service as a node
- Connections between them (labeled: REST, gRPC, Kafka, shared DB, etc.)
- External dependencies (third-party APIs, managed services)
- Data stores (databases, caches, queues)

Then a **Stack Inventory Table**:

| Service | Language | Framework | Database | Deploys to | Depends on | Depended on by |
|---------|----------|-----------|----------|------------|------------|----------------|

Then a **Connection Matrix** showing which services talk to which:

| | Service A | Service B | Service C | DB-1 | Kafka |
|---|-----------|-----------|-----------|------|-------|
| Service A | — | REST | — | R/W | produce |
| Service B | — | — | gRPC | R | consume |

Then **Danger Zones** at the stack level:
- Single points of failure
- Services with the most inbound dependencies (change carefully)
- Shared databases (schema changes affect multiple services)
- Missing monitoring or health checks

### 5. If Graphify is available
Run `graphify run [parent-dir] --directed` on the entire parent directory to get a unified knowledge graph across all services. The graph will show cross-service relationships that are hard to find manually.
