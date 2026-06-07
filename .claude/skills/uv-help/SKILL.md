---
name: uv-help
description: >
  Show all UV Suite skills, agents, hooks, guardrails, and personas.
  Use when you want to know what's available or how to use a specific feature.
argument-hint: "[skill-name or topic]"
user-invocable: true
allowed-tools:
  - Read(*)
  - Glob(*)
---

## UV Suite Help

$ARGUMENTS

If the user asked about a specific skill or topic, focus on that. Otherwise, show the full overview below.

## Active persona

!`grep "Active persona" CLAUDE.md 2>/dev/null || echo "Unknown — check .claude/settings.json"`

## All available skills

Every skill accepts free-form arguments to direct the agent. Examples shown below.

### Understand

| Skill | What it does | Example |
|-------|-------------|---------|
| `/map-codebase [focus]` | Build a knowledge graph of the codebase | `/map-codebase focus on the auth flow and session management` |
| `/map-stack [dir]` | Map multiple services and their connections | `/map-stack show how layer3-max calls layer2-pie` |

### Plan

| Skill | What it does | Example |
|-------|-------------|---------|
| `/spec [requirements]` | Write a technical specification | `/spec webhook retry with exponential backoff, max 3 retries` |
| `/architect [spec]` | Design architecture, decompose into Acts | `/architect design for horizontal scaling, expect 10x traffic` |

### Build

| Skill | What it does | Example |
|-------|-------------|---------|
| `/write-tests [target]` | Generate tests matching project conventions | `/write-tests src/auth/login.ts focus on error paths` |
| `/write-evals [prompt]` | Write AI/LLM evaluation cases | `/write-evals test the search ranking prompt for adversarial inputs` |
| `/prototype [concept]` | Build a static React prototype | `/prototype event booking app with calendar and payment flow` |

### Review

| Skill | What it does | Example |
|-------|-------------|---------|
| `/review [focus]` | Code review: correctness, security, perf, slop | `/review pay attention to the new database migration` |
| `/slop-check [target]` | Detect 6 categories of AI-generated slop | `/slop-check src/components/ check for over-engineering` |
| `/security-review [target]` | OWASP audit, dependency scan, secret detection | `/security-review src/payments/ focus on webhook signature validation` |

### Ship

| Skill | What it does | Example |
|-------|-------------|---------|
| `/commit [message]` | Test, lint, review, commit (optionally open PR) | `/commit "Add webhook retry logic" pr` |
| `/investigate [bug]` | Root-cause debugging (3 attempts then escalate) | `/investigate search returns stale results after reindex` |

### Session

| Skill | What it does | Example |
|-------|-------------|---------|
| `/checkpoint [label]` | Save session state for next time | `/checkpoint auth-refactor` |
| `/restore` | Load latest checkpoint at session start | `/restore` |

## Agents (spawned by skills)

| Agent | Model | Used by |
|-------|-------|---------|
| Cartographer | Opus | /map-codebase, /map-stack |
| Spec Writer | Opus | /spec |
| Architect | Opus | /architect |
| Reviewer | Opus | /review, /investigate |
| Test Writer | Sonnet | /write-tests |
| Eval Writer | Opus | /write-evals |
| Anti-Slop Guard | Opus | /slop-check |
| Prototype Builder | Sonnet | /prototype |
| DevOps | Opus | (direct invocation) |
| Security | Opus | /security-review |

## Hooks (automatic, you don't invoke these)

!`ls .claude/hooks/*.sh 2>/dev/null | while read f; do echo "- $(basename $f)"; done || echo "No hooks installed"`

## Guardrails (anti-slop rules, active as context)

!`ls .claude/rules/*.md 2>/dev/null | while read f; do echo "- $(basename $f .md)"; done || echo "No guardrails installed"`

## Personas

| Persona | Launch | For |
|---------|--------|-----|
| Spike | `uvs spike` | Research, docs, architecture analysis |
| Sport | `uvs sport` | New projects, fast prototyping |
| Professional | `uvs pro` | Production code, full review rigor |
| Auto | `uvs auto` | Autonomous execution, clear specs |

## Artifacts

All agent output goes to `uv-out/`. Agents read each other's prior output automatically.

!`ls uv-out/*.md uv-out/**/*.md 2>/dev/null | head -15 || echo "No artifacts yet — run a skill to generate some"`

## Tips

- **Direct the agent:** Every skill accepts arguments. "/review" does a generic review. "/review focus on the error handling in the retry logic" gives targeted results.
- **Run in parallel:** "Run /review, /slop-check, and /security-review in parallel" — Claude spawns all three simultaneously.
- **Checkpoint before stopping:** "/checkpoint" saves your session state. "/restore" loads it next time.
- **Use the right persona:** `uvs spike` for research, `uvs pro` for production code, `uvs auto` to let it run.
