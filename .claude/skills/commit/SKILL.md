---
name: commit
description: >
  Review, test, slop-check, then commit and optionally open a PR.
  The ship pipeline: one command from "code complete" to "committed and reviewed."
argument-hint: "[commit-message or 'pr']"
user-invocable: true
allowed-tools:
  - Read(*)
  - Grep(*)
  - Glob(*)
  - Write(*)
  - Bash(git *)
  - Bash(npm test *)
  - Bash(npm run test *)
  - Bash(npm run lint *)
  - Bash(npx jest *)
  - Bash(npx vitest *)
  - Bash(pytest *)
  - Bash(go test *)
  - Bash(cargo test *)
  - Bash(gh pr *)
---

## Intent

$ARGUMENTS

## Current state

!`git status --short 2>/dev/null | head -30 || echo "not a git repo"`

!`git diff --cached --stat 2>/dev/null || echo "nothing staged"`

!`git diff --stat 2>/dev/null || echo "no unstaged changes"`

## Pipeline — run these steps in order

### 1. Run tests

Find and run the project's test command. If tests fail, fix the failures before continuing. If they can't be fixed in 2 attempts, stop and report.

### 2. Run lint

If a lint command exists (npm run lint, ruff check, etc.), run it. Fix auto-fixable issues.

### 3. Quick slop check

Scan changed files for the most obvious patterns:
- `toBeTruthy()` / `toBeDefined()` in test files
- Bare `except: pass` in Python

Don't run the full /slop-check agent — just grep for mechanical patterns.

### 4. Review the diff

Read the full diff. Check for:
- Correctness: does it do what it should?
- Security: any obvious issues? (hardcoded secrets, missing auth checks)
- Completeness: anything half-done or TODO'd?

If you find issues, fix them. If they need human input, stop and ask.

### 5. Stage and commit

- Stage the relevant files (not `.env`, not `node_modules`, not build artifacts)
- Write a commit message. If the user provided one in $ARGUMENTS, use it. Otherwise, write a concise message that describes the WHY, not the WHAT.
- Commit.

### 6. Open PR (if requested)

If the user said "pr" in their arguments, or if on a feature branch:
- Push the branch
- Open a PR with `gh pr create`
- Title: short, under 70 chars
- Body: summary bullets + test plan

### 7. Checkpoint

After committing, write a checkpoint to `uv-out/checkpoints/latest.md` with what was committed.

## Danger zones

!`cat DANGER-ZONES.md 2>/dev/null || echo "No DANGER-ZONES.md"`

## Rules

- If tests fail and can't be fixed quickly, STOP. Don't commit broken code.
- If the diff touches a danger zone file, flag it before committing.
- Prefer separate commits per logical change if there are unrelated changes staged.
- Never commit .env, credentials, or secrets.
