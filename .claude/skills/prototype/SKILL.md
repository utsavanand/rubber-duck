---
name: prototype
description: >
  Build an interactive prototype as a static React site. For concept exploration,
  stakeholder demos, presentations, and documentation websites.
argument-hint: "[concept-description]"
user-invocable: true
context: fork
agent: prototype-builder
model: claude-sonnet-4-6
effort: high
allowed-tools:
  - Read(*)
  - Grep(*)
  - Glob(*)
  - Write(*)
  - Edit(*)
  - Bash(npm *)
  - Bash(npx *)
  - Bash(node *)
  - Bash(mkdir *)
  - Bash(ls *)
---

## Concept

$ARGUMENTS
