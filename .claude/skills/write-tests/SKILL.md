---
name: write-tests
description: >
  Generate meaningful tests that verify behavior. Use after implementing a feature or when
  coverage is low. Matches project test conventions.
argument-hint: "[file-or-module-to-test]"
user-invocable: true
context: fork
agent: test-writer
model: claude-sonnet-4-6
effort: high
allowed-tools:
  - Read(*)
  - Grep(*)
  - Glob(*)
  - Write(*)
  - Edit(*)
  - Bash(npm test *)
  - Bash(npm run test *)
  - Bash(npx jest *)
  - Bash(npx vitest *)
  - Bash(pytest *)
  - Bash(go test *)
  - Bash(cargo test *)
  - Bash(mvn test *)
---

## Target

$ARGUMENTS

## Existing test patterns (match these)

!`find . -name "*.test.*" -o -name "*.spec.*" -o -name "test_*" 2>/dev/null | head -5`

!`cat $(find . -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | head -1) 2>/dev/null | head -40 || echo "No existing tests found"`

## Project test command

!`cat package.json 2>/dev/null | grep -A2 '"test"' || echo "No package.json test script"`

## Prior analysis

### Spec (what to test against)

!`cat $(ls -t uv-out/specs/*.md 2>/dev/null | head -1) 2>/dev/null | head -60 || echo "No spec found — test based on code behavior"`

### Acts plan (current task context)

!`cat uv-out/architecture/acts-plan.md 2>/dev/null | head -40 || echo "No acts plan found"`

### Session checkpoint

!`cat uv-out/checkpoints/latest.md 2>/dev/null | head -40 || echo "No checkpoint"`
