---
name: write-evals
description: >
  Write evaluations for AI system prompts and inferencing layers.
  Use when building or modifying LLM-powered features.
argument-hint: "[prompt-file-or-description]"
user-invocable: true
context: fork
agent: eval-writer
model: claude-opus-4-6
effort: high
allowed-tools:
  - Read(*)
  - Grep(*)
  - Glob(*)
  - Write(*)
  - Edit(*)
  - Bash(npm run eval *)
  - Bash(pytest *)
---

## Target

$ARGUMENTS

## Existing eval framework

!`find . -name "*eval*" -o -name "*evals*" 2>/dev/null | head -10 || echo "No eval files found"`

## Prior analysis

### Spec (requirements to evaluate against)

!`cat $(ls -t uv-out/specs/*.md 2>/dev/null | head -1) 2>/dev/null | head -60 || echo "No spec found"`
