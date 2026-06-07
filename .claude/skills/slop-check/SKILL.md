---
name: slop-check
description: >
  Detect AI-generated slop in code, tests, docs, and architecture.
  Run before merging any AI-generated changes.
argument-hint: "[file-or-directory]"
user-invocable: true
context: fork
agent: anti-slop-guard
model: claude-opus-4-6
effort: high
allowed-tools:
  - Read(*)
  - Grep(*)
  - Glob(*)
  - Bash(git diff *)
  - Bash(git log *)
---

## Target

$ARGUMENTS

## Changes to scan

!`git diff --cached --stat 2>/dev/null || git diff --stat 2>/dev/null || echo "No changes — scan target files directly"`

### Full diff

!`git diff --cached 2>/dev/null || git diff 2>/dev/null || echo ""`

## Prior analysis

### Architecture decisions (check code against stated rationale)

!`cat uv-out/architecture/decisions.md 2>/dev/null | head -40 || echo "No architecture decisions found"`

### Recent review findings

!`cat $(ls -t uv-out/review-*.md 2>/dev/null | head -1) 2>/dev/null | head -40 || echo "No prior review found"`
