---
name: investigate
description: >
  Systematic root-cause debugging. Traces data flow, tests hypotheses,
  narrows scope. Stops after 3 failed attempts and escalates.
  Use when something is broken and you don't know why.
argument-hint: "[bug-description or error-message]"
user-invocable: true
context: fork
agent: reviewer
model: claude-opus-4-6
effort: max
allowed-tools:
  - Read(*)
  - Grep(*)
  - Glob(*)
  - Bash(git log *)
  - Bash(git diff *)
  - Bash(git blame *)
  - Bash(git show *)
  - Bash(npm test *)
  - Bash(npm run *)
  - Bash(npx *)
  - Bash(pytest *)
  - Bash(go test *)
  - Bash(cargo test *)
  - Bash(curl *)
  - Bash(node *)
  - Bash(python *)
---

## The bug

$ARGUMENTS

## Project context

!`cat CLAUDE.md 2>/dev/null || echo "No CLAUDE.md"`

## Codebase map

!`cat uv-out/map-codebase.md 2>/dev/null | head -60 || echo "No codebase map"`

## Recent changes (potential cause)

!`git log --oneline -15 2>/dev/null || echo "no git"`

## Latest checkpoint

!`cat uv-out/checkpoints/latest.md 2>/dev/null | head -30 || echo "No checkpoint"`

## Investigation methodology

Follow this process strictly:

### Phase 1: Reproduce

Before investigating, reproduce the bug. Run the failing test, hit the failing endpoint, trigger the error. If you can't reproduce it, say so and ask for reproduction steps.

### Phase 2: Narrow scope

Form a hypothesis about WHERE the bug is:
1. Read the error message/stack trace carefully
2. Identify the failing component (which file, which function, which layer)
3. Check recent changes to that component (`git log --oneline [file]`)
4. Check if the component was modified in the last 5 commits (`git diff HEAD~5 [file]`)

State your hypothesis explicitly: "I think the bug is in [X] because [Y]."

### Phase 3: Test the hypothesis

Verify your hypothesis with the smallest possible test:
- Add a log/print statement
- Write a focused test case
- Run a specific command that isolates the behavior

If the hypothesis is wrong, form a new one. Track what you've ruled out.

### Phase 4: Fix or escalate

If you found the root cause within 3 attempts: fix it, run the tests, verify.

If you haven't found it after 3 attempts:

```
## Stuck: [bug description]

Ruled out:
1. [Hypothesis 1] — wrong because [evidence]
2. [Hypothesis 2] — wrong because [evidence]  
3. [Hypothesis 3] — wrong because [evidence]

Remaining possibilities:
- [What I haven't checked yet]

What I need:
- [Specific question or access needed from the human]
```

## Rules

- NO FIXES WITHOUT INVESTIGATION. Don't guess and patch. Find the root cause first.
- State hypotheses explicitly before testing them.
- Track what you've ruled out so you don't revisit.
- 3 attempts max. Then escalate with structured findings.
- If the bug is in code you don't understand, run /map-codebase on that area first.

## Artifact output

Write investigation findings to `uv-out/investigate-YYYY-MM-DD.md`. Include: bug description, hypotheses tested, root cause found (or not), fix applied (or escalation).
