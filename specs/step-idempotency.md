# Step Idempotency Specification

This document specifies idempotency patterns for step functions.

## Overview

Since step functions can retry, all side effects must be idempotent—safe to execute multiple times with the same result. The workflow runtime provides `getStepMetadata()` which includes a unique `stepId` perfect for idempotency keys.

## getStepMetadata()

```typescript
import { getStepMetadata } from "workflow";

async function myStep() {
  "use step";
  
  const {
    stepId,        // Unique identifier for this step execution
    attempt,       // Current attempt number (1-based)
    stepStartedAt  // Timestamp when step began
  } = getStepMetadata();
}
```

## Idempotency Patterns

### External API Calls

Use `stepId` as the idempotency key for external APIs:

```typescript
async function chargeCustomer(customerId: string, amount: number) {
  "use step";
  
  const { stepId } = getStepMetadata();
  
  // Same stepId = same charge, even on retry
  await stripe.charges.create({
    customer: customerId,
    amount: amount,
    idempotencyKey: stepId  // Stripe will deduplicate
  });
}
```

### Database Operations

Use `stepId` for upsert operations:

```typescript
async function createOrder(items: Item[], userId: string) {
  "use step";
  
  const { stepId } = getStepMetadata();
  
  // Upsert pattern prevents duplicates
  const order = await db.orders.upsert({
    where: { idempotencyKey: stepId },
    create: {
      idempotencyKey: stepId,
      userId,
      items,
      status: 'pending'
    },
    update: {}  // No-op if exists
  });
  
  return order;
}
```

### Email Sending

Deduplicate emails using `stepId`:

```typescript
async function sendDunningEmail(options: SendDunningEmailOptions) {
  "use step";
  
  const { stepId } = getStepMetadata();
  
  // Check if already sent (using local store for demo)
  if (dunningStore.wasEmailSent(stepId)) {
    return { sent: false, reason: 'already_sent' };
  }
  
  // Send email
  const result = await emailService.send({
    to: options.to,
    subject: getSubject(options.escalationLevel),
    body: getBody(options),
  });
  
  // Record as sent
  dunningStore.logEmail({
    idempotencyKey: stepId,
    to: options.to,
    invoiceId: options.invoiceId,
    // ...
  });
  
  return { sent: true, emailId: result.id };
}
```

### Subscription Operations

Prevent duplicate subscription modifications:

```typescript
async function restrictCustomerAccess(options: RestrictAccessOptions) {
  "use step";
  
  const { stepId } = getStepMetadata();
  
  // Check if already executed
  if (dunningStore.wasOperationExecuted(stepId)) {
    return { executed: false, reason: 'already_executed' };
  }
  
  // Execute restriction
  await subscriptionService.restrictAccess(options.customerId);
  
  // Record operation
  dunningStore.logSubscriptionOperation({
    type: 'restrict_access',
    targetId: options.customerId,
    idempotencyKey: stepId,
  });
  
  return { executed: true };
}
```

## Application Implementation

### check-invoice-status.ts

Status checks are naturally idempotent (read-only), but logging should use `stepId`:

```typescript
export async function checkInvoiceStatus(invoiceId: string): Promise<InvoiceState> {
  "use step";
  
  const { stepId, attempt } = getStepMetadata();
  
  console.log(`[checkInvoiceStatus] invoiceId=${invoiceId} stepId=${stepId} attempt=${attempt}`);
  
  // Read-only operation - inherently idempotent
  const invoice = await mockStripe.getInvoice(invoiceId);
  return invoice;
}
```

### send-dunning-email.ts

```typescript
export async function sendDunningEmail(options: SendDunningEmailOptions): Promise<SendDunningEmailResult> {
  "use step";
  
  const { stepId } = getStepMetadata();
  
  const result = await mockEmailService.sendEmail({
    to: options.to,
    customerId: options.customerId,
    invoiceId: options.invoiceId,
    escalationLevel: getEscalationLevel(options.attemptNumber),
    webhookUrl: options.webhookUrl,
    idempotencyKey: stepId,  // Deduplication key
  });
  
  return {
    sent: result.sent,
    emailId: result.emailId,
    escalationLevel: result.escalationLevel,
  };
}
```

### restrict-access.ts

```typescript
export async function restrictCustomerAccess(options: RestrictAccessOptions): Promise<RestrictAccessResult> {
  "use step";
  
  const { stepId } = getStepMetadata();
  
  const result = await mockSubscriptionService.restrictAccess(
    options.customerId,
    stepId  // Idempotency key
  );
  
  return {
    executed: result.executed,
    customerId: options.customerId,
    reason: result.reason,
  };
}
```

### execute-final-action.ts

```typescript
export async function executeFinalAction(options: ExecuteFinalActionOptions): Promise<ExecuteFinalActionResult> {
  "use step";
  
  const { stepId } = getStepMetadata();
  
  let result: OperationResult;
  
  switch (options.action) {
    case 'pause':
      result = await mockSubscriptionService.pauseSubscription(
        options.subscriptionId,
        stepId  // Idempotency key
      );
      break;
    case 'cancel':
      result = await mockSubscriptionService.cancelSubscription(
        options.subscriptionId,
        stepId
      );
      break;
    case 'mark_unpaid':
      result = await mockSubscriptionService.markUnpaid(
        options.invoiceId,
        stepId
      );
      break;
  }
  
  return {
    executed: result.executed,
    action: options.action,
    reason: result.reason,
  };
}
```

## Mock Provider Support

The mock providers should support idempotency keys:

```typescript
// providers/email.ts
class MockEmailService {
  private sentEmails: Map<string, EmailResult> = new Map();
  
  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    // Check for duplicate
    if (options.idempotencyKey) {
      const existing = this.sentEmails.get(options.idempotencyKey);
      if (existing) {
        return { sent: false, reason: 'duplicate', emailId: existing.emailId };
      }
    }
    
    // Send email
    const result = { sent: true, emailId: `email_${Date.now()}` };
    
    // Store for deduplication
    if (options.idempotencyKey) {
      this.sentEmails.set(options.idempotencyKey, result);
    }
    
    return result;
  }
}
```

## Verification Checklist

- [ ] All step functions use `getStepMetadata()` to get `stepId`
- [ ] External API calls use `stepId` as idempotency key
- [ ] Database writes use upsert pattern with `stepId`
- [ ] Email sending checks for duplicates using `stepId`
- [ ] Subscription operations deduplicate using `stepId`
- [ ] Mock providers support idempotency key parameter
