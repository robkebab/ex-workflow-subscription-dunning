# error-fatal-error

**Impact: HIGH (prevents wasted retries)**

Use `FatalError` when retrying would be pointless—the error is permanent and won't resolve with time.

## When to Use FatalError

- Validation errors
- Resource not found (404)
- Authorization failures (401, 403)
- Invalid input
- Business rule violations
- Permanent external service errors

## Incorrect: Retrying Permanent Failures

```typescript
async function processPayment(orderId: string, amount: number) {
  "use step";
  
  if (amount <= 0) {
    // This will retry 3 times before failing - wasteful!
    throw new Error('Invalid payment amount')
  }
  
  // ...
}
```

## Correct: Use FatalError

```typescript
import { FatalError } from "workflow";

async function processPayment(orderId: string, amount: number) {
  "use step";
  
  if (amount <= 0) {
    // Fails immediately - no retries
    throw new FatalError('Invalid payment amount')
  }
  
  const order = await db.orders.findUnique({ where: { id: orderId } })
  
  if (!order) {
    throw new FatalError(`Order not found: ${orderId}`)
  }
  
  if (order.status === 'cancelled') {
    throw new FatalError('Cannot process cancelled order')
  }
  
  return await chargeCard(order.customerId, amount)
}
```

## Full Example: HTTP Error Handling

```typescript
import { FatalError, RetryableError } from "workflow";

async function callAPI(endpoint: string) {
  "use step";
  
  const response = await fetch(endpoint)
  
  // Client errors - don't retry
  if (response.status === 400) {
    throw new FatalError('Bad request - check input')
  }
  if (response.status === 401) {
    throw new FatalError('Unauthorized - check credentials')
  }
  if (response.status === 403) {
    throw new FatalError('Forbidden - insufficient permissions')
  }
  if (response.status === 404) {
    throw new FatalError('Resource not found')
  }
  
  // Server errors - retry
  if (response.status >= 500) {
    throw new RetryableError(`Server error: ${response.status}`)
  }
  
  return response.json()
}
```
