# Guardrail: Comment Slop

**Severity:** High (actively obscures code)
**Category:** Code quality

## Pattern

Comments that restate what the code already says, adding no information.

## Detection Rule

If deleting the comment and reading the code tells you the same thing, the comment is slop. Comments should explain **why**, not **what**.

## Examples

### Slop

```typescript
// Initialize the database connection
const db = initDatabase();

// Set the user's name
user.name = newName;

// Loop through the items
for (const item of items) {

// Return the result
return result;

// Check if the user is valid
if (isValid(user)) {
```

### Not Slop

```typescript
// Retry with exponential backoff because the API rate-limits
// at 100 req/min and our batch size exceeds that
const db = initDatabase({ retries: 3, backoff: 'exponential' });

// Normalize Unicode before comparison — we've seen cases where
// visually identical names fail equality checks (NFD vs NFC)
user.name = newName.normalize('NFC');

// Skip soft-deleted records intentionally — the reports team
// needs historical data including deleted entries
const records = db.query('SELECT * FROM orders');
```

## Fix

Delete the comment. If the code genuinely needs explanation, rename the variable or function to be self-documenting. Only add a comment when there's context the code can't express (business decisions, workarounds, non-obvious constraints).
