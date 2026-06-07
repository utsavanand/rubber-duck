# Guardrail: Over-Engineering Slop

**Severity:** High (inflates maintenance burden)
**Category:** Code quality

## Pattern

Abstractions, patterns, and indirection that serve no current purpose. AI models love creating "clean architecture" with factories, interfaces, and wrappers that only have one implementation.

## Detection Rules

- Interface with only one implementation
- Factory that creates only one type
- Abstract class with only one subclass
- Wrapper that adds no behavior
- Configuration for values that never change
- Generic type parameter that's always the same concrete type
- "Strategy pattern" with one strategy
- Builder pattern for objects with 2-3 fields

## Examples

### Slop

```typescript
// Factory for a single implementation
interface PaymentProcessor {
  process(payment: Payment): Promise<Result>;
}

class PaymentProcessorFactory {
  static create(type: string): PaymentProcessor {
    switch (type) {
      case 'stripe': return new StripePaymentProcessor();
      default: throw new Error(`Unknown type: ${type}`);
    }
  }
}

class StripePaymentProcessor implements PaymentProcessor {
  async process(payment: Payment): Promise<Result> {
    return stripe.charges.create({ amount: payment.amount });
  }
}
```

### Not Slop

```typescript
// Direct call — add abstraction when you need a second processor
await stripe.charges.create({ amount: payment.amount });
```

## Fix

Delete the abstraction. Call the thing directly. Add abstraction when (not before) you need it. If you have two implementations, then the interface earns its place.
