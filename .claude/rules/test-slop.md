# Guardrail: Test Slop

**Severity:** High (creates false sense of coverage)
**Category:** Testing quality

## Pattern

Tests that pass but don't actually verify behavior. They inflate coverage metrics without catching bugs.

## Detection Rules

- `expect(x).toBeTruthy()` or `expect(x).toBeDefined()` — almost always slop
- Tests where the mock is the only thing being tested
- Snapshot tests on simple/trivial components
- Tests with no assertions
- Tests that test framework behavior ("does React render a component?")
- Test name doesn't match what's actually being tested
- Copy-pasted tests with only minor variations (use parameterized tests)

## Examples

### Slop

```typescript
// Tests existence, not behavior
test('should create a user', () => {
  const user = createUser({ name: 'Alice' });
  expect(user).toBeTruthy();
});

// Tests the mock, not the code
test('should fetch user', async () => {
  mockFetch.mockResolvedValue({ name: 'Alice' });
  const user = await fetchUser(1);
  expect(user.name).toBe('Alice'); // You told the mock to return this
});

// Snapshot of a trivial component
test('should render', () => {
  const tree = renderer.create(<Button>Click</Button>);
  expect(tree.toJSON()).toMatchSnapshot();
});
```

### Not Slop

```typescript
// Tests specific behavior
test('createUser hashes password before storing', async () => {
  const user = await createUser({ name: 'Alice', password: 'secret123' });
  expect(user.passwordHash).not.toBe('secret123');
  expect(await bcrypt.compare('secret123', user.passwordHash)).toBe(true);
});

// Tests real behavior with real dependency
test('fetchUser returns null for non-existent user', async () => {
  const user = await fetchUser(999);
  expect(user).toBeNull();
});

// Tests meaningful interaction
test('Button calls onClick when clicked', () => {
  const onClick = jest.fn();
  render(<Button onClick={onClick}>Click</Button>);
  fireEvent.click(screen.getByText('Click'));
  expect(onClick).toHaveBeenCalledTimes(1);
});
```

## Fix

Delete tests that can't fail meaningfully. Rewrite to test actual behavior: specific values, specific side effects, specific error conditions. Ask: "Would this test catch a real bug?"
