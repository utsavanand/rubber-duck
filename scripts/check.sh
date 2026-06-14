#!/usr/bin/env bash
# One gate to run before committing: lint, types, and all three test layers
# (unit, API/runtime, UI/Playwright). Exits non-zero on the first failure.
#
#   scripts/check.sh            # everything
#   scripts/check.sh --no-ui    # skip the slow browser layer (e.g. quick loop)
#
# The pre-commit hook calls this; CI should too.
set -euo pipefail
cd "$(dirname "$0")/.."

RUN_UI=1
[[ "${1:-}" == "--no-ui" ]] && RUN_UI=0

# Use the repo venv if present so this works without an activated shell.
PY=python
[[ -x .venv/bin/python ]] && PY=.venv/bin/python
RUFF=ruff; MYPY=mypy; BLACK=black
[[ -x .venv/bin/ruff ]] && RUFF=.venv/bin/ruff
[[ -x .venv/bin/mypy ]] && MYPY=.venv/bin/mypy
[[ -x .venv/bin/black ]] && BLACK=.venv/bin/black

step() { printf "\n\033[1m==> %s\033[0m\n" "$1"; }

step "ruff (lint)"
$RUFF check src tests

# Same checks CI runs, so a green local gate means a green CI.
step "black (format)"
$BLACK --check src tests scripts

step "mypy (types)"
$MYPY

step "Python tests (unit + API/runtime)"
$PY -m pytest -p no:cacheprovider

step "slop check (docs/tests heuristics)"
$PY scripts/slop_check.py

if [[ $RUN_UI == 1 ]]; then
  step "UI tests (Playwright) — builds + serves the real dashboard"
  # The e2e server serves the bundled dashboard, so build + sync it first.
  ( cd web && npm run build >/dev/null )
  rm -rf src/rubberduck/dashboard
  mkdir -p src/rubberduck/dashboard
  cp -r web/dist/. src/rubberduck/dashboard/
  ( cd web && PATH="$PWD/../.venv/bin:$PATH" npm run e2e )
else
  step "UI tests SKIPPED (--no-ui)"
fi

printf "\n\033[1;32mAll checks passed.\033[0m\n"
