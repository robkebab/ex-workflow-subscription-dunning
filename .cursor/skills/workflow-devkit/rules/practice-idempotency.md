# practice-idempotency

**Impact: HIGH (prevents duplicate side effects)**

Since steps can retry, all side effects must be idempotent—safe to execute multiple times with the same result.

## The Problem

```typescript
async function chargeCustomer(customerId: string, amount: number) {
  "use step";
  
  // BAD: If this step retries, customer gets charged multiple times!
  await stripe.charges.create({
    customer: customerId,
    amount: amount
  })
}
```

If the step fails after charging but before completing, the retry will charge again.

## Solution: Use Idempotency Keys

```typescript
import { getStepMetadata } from "workflow";

async function chargeCustomer(customerId: string, amount: number) {
  "use step";
  
  const { stepId } = getStepMetadata()
  
  // Same stepId = same charge, even on retry
  await stripe.charges.create({
    customer: customerId,
    amount: amount,
    idempotencyKey: stepId
  })
}
```

## Database Example

```typescript
import { getStepMetadata } from "workflow";

async function createOrder(items: Item[], userId: string) {
  "use step";
  
  const { stepId } = getStepMetadata()
  
  // Upsert prevents duplicates on retry
  const order = await db.orders.upsert({
    where: { idempotencyKey: stepId },
    create: {
      idempotencyKey: stepId,
      userId,
      items,
      status: 'pending'
    },
    update: {}  // No-op if exists
  })
  
  return order
}
```

## Email Example

```typescript
import { getStepMetadata } from "workflow";

async function sendWelcomeEmail(userId: string) {
  "use step";
  
  const { stepId } = getStepMetadata()
  
  // Check if already sent
  const existing = await db.sentEmails.findUnique({
    where: { idempotencyKey: stepId }
  })
  
  if (existing) {
    return existing  // Already sent
  }
  
  await emailService.send({
    to: userId,
    template: 'welcome'
  })
  
  // Record that we sent it
  return await db.sentEmails.create({
    data: { idempotencyKey: stepId, userId, type: 'welcome' }
  })
}
```

## Key Point

`getStepMetadata().stepId` is stable across retries—use it as your idempotency key.
