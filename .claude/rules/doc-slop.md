# Guardrail: Documentation Slop

**Severity:** Medium (misleads readers, creates false sense of documentation)
**Category:** Documentation quality

## Pattern

Documentation that uses words without saying anything specific. Vague adjectives, appeals to authority, feature lists that could describe any system.

## Detection Rules

**Vague adjectives (red flags):**
- "Robust", "scalable", "maintainable", "comprehensive", "extensive"
- "Elegant", "clean", "modern", "cutting-edge", "state-of-the-art"
- "Enterprise-grade", "production-ready", "battle-tested"

**Evasive verbs:**
- "Leverages", "utilizes", "facilitates", "empowers", "enables"

**Authority appeals:**
- "Best practices", "industry-standard", "widely adopted"
- Without naming the specific practice

**Generic feature lists:**
- "Comprehensive error handling" — what errors? What handling?
- "Flexible configuration options" — what options? What's configurable?
- "Extensive logging" — what's logged? Where? What format?

## Examples

### Slop

```markdown
## Overview
This module provides a robust, scalable, and maintainable solution for
handling user authentication. It leverages industry-standard best practices
to ensure secure and efficient credential management.

## Features
- Comprehensive authentication flow
- Secure credential storage
- Flexible configuration options
- Extensive error handling
```

### Not Slop

```markdown
## What This Does
Handles login, signup, and session management using bcrypt for password
hashing and JWT for session tokens. Sessions expire after 24 hours.

## Endpoints
- POST /auth/signup — Create account (email + password)
- POST /auth/login — Get JWT token
- POST /auth/logout — Invalidate session
- GET /auth/me — Get current user (requires valid JWT)
```

## Fix

Replace every vague adjective with a specific fact. "Robust error handling" becomes "Retries 3 times with exponential backoff on 5xx errors." If you can't make it specific, delete it — the absence of vague claims is better than their presence.
