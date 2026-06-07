# Guardrail: Error Handling Slop

**Severity:** Medium (adds noise, obscures real error paths)
**Category:** Code quality

## Pattern

Try/catch blocks around code that can't throw, or that catch and re-throw without adding value. Defensive checks for impossible states.

## Detection Rules

- Try/catch where the try block can't throw
- Catch that only logs and re-throws (the caller handles it)
- Error handling for impossible states (e.g., validating a non-null TypeScript param isn't null)
- Defensive checks deep inside internal functions (trust the caller at internal boundaries)
- Catching generic `Error` when only specific errors are possible

## Examples

### Slop

```typescript
// JSON.stringify doesn't throw on a plain object
try {
  const json = JSON.stringify(user);
  return json;
} catch (error) {
  console.error('Failed to stringify user:', error);
  throw error;
}

// Catch, log, re-throw — adds nothing
try {
  const result = await fetchUser(id);
  return result;
} catch (error) {
  console.error('Error fetching user:', error);
  throw error;
}

// Null check on TypeScript non-null parameter
function processUser(user: User): void {
  if (!user) throw new Error('User is required'); // TypeScript already prevents this
}
```

### Not Slop

```typescript
// No try/catch needed — let errors propagate naturally
const json = JSON.stringify(user);
return json;

// Handle the error meaningfully at the system boundary
try {
  const result = await fetchUser(id);
  return result;
} catch (error) {
  return { error: 'User not found', status: 404 };
}
```

## Fix

Remove the try/catch. Only add error handling at system boundaries (user input, network calls, file I/O) or when converting the error to a different type/format. Let internal errors propagate naturally.
