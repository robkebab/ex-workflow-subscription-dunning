# directive-use-workflow

**Impact: CRITICAL (enables durability and replay)**

Mark orchestration functions with the `"use workflow"` directive to enable durable execution, replay, and observability.

## Incorrect

```typescript
// This function won't be transformed - it's just a regular async function
export async function processOrder(orderId: string) {
  const order = await fetchOrder(orderId)
  await chargePayment(order)
  await sendConfirmation(order)
  return { success: true }
}
```

Without the directive, the function is a regular async function with no durability guarantees.

## Correct

```typescript
export async function processOrder(orderId: string) {
  "use workflow";
  
  const order = await fetchOrder(orderId)
  await chargePayment(order)
  await sendConfirmation(order)
  return { success: true }
}
```

With the directive, the function:
- Can suspend and resume after server restarts
- Replays deterministically using cached step results
- Has observable execution via the Workflow DevKit dashboard
- Gets a stable `workflowId` for identification

## Key Points

- Directive must be the first statement inside the function body
- Function must be `async`
- All side effects must be performed in step functions, not directly
