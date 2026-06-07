---
name: spec
description: >
  Convert requirements into a structured technical specification. Use when starting a new feature
  or receiving vague requirements.
argument-hint: "[requirements-description]"
user-invocable: true
context: fork
agent: spec-writer
model: claude-opus-4-6
effort: high
allowed-tools:
  - Read(*)
  - Grep(*)
  - Glob(*)
  - Write(*)
---

## Requirements

$ARGUMENTS

## Project context

!`cat CLAUDE.md 2>/dev/null || echo "No CLAUDE.md found"`

## Existing architecture

!`ls -la docs/architecture* 2>/dev/null || echo "No architecture docs found"`

## Today's date

!`date +%Y-%m-%d`
