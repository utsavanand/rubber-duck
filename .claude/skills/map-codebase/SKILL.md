---
name: map-codebase
description: >
  Map a codebase or directory: build a knowledge graph (via Graphify if available),
  then produce architecture overview, business domain map, sequence diagrams, and 
  entry points. Use when entering a new codebase or unfamiliar area.
argument-hint: "[directory-or-question]"
user-invocable: true
context: fork
agent: cartographer
model: claude-opus-4-6
effort: high
allowed-tools:
  - Read(*)
  - Grep(*)
  - Glob(*)
  - Bash(graphify *)
  - Bash(find *)
  - Bash(git log *)
  - Bash(git ls-files *)
  - Bash(wc *)
  - Bash(head *)
  - Bash(pip *)
---

## Target

$ARGUMENTS

If no target specified, map the current project root.

## Graphify availability

```!
graphify --version 2>/dev/null || echo "NOT_INSTALLED"
```

## Existing knowledge graph (if previously generated)

```!
cat graphify-out/GRAPH_REPORT.md 2>/dev/null | head -80 || echo "No existing graph found"
```

## Project context

!`cat CLAUDE.md 2>/dev/null || echo "No CLAUDE.md found"`

## Danger zones

!`cat DANGER-ZONES.md 2>/dev/null || echo "No DANGER-ZONES.md found"`

## Prior analysis (if re-mapping)

!`cat uv-out/map-codebase.md 2>/dev/null | head -30 || echo "No prior map — fresh scan"`
