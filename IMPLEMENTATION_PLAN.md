# Subscription Dunning Workflow - Implementation Plan

A production-leaning reference example demonstrating durable subscription dunning orchestration using Workflow DevKit.

## Overview

The workflow handles failed invoice payments with:
- Escalating email notifications with increasing urgency
- Customer self-service recovery via webhook URLs
- Access restrictions after a configurable threshold
- Pause subscription as the final action
- Full idempotency and retry handling

## Configuration Choices

| Setting | Value |
|---------|-------|
| Notification channel | Email only (mock) |
| Billing provider | Mock Stripe (no API keys) |
| Default retry schedule | 3 attempts: 1d, 3d, 7d |
| Final action | Pause subscription |
| Access restriction | Yes, after configurable threshold |
| Demo interface | API routes (curl/Postman testing) |
| Webhook verification | Skip (note in comments) |
| Fix payment link | Workflow webhook URL directly |
| Email templates | Escalating urgency per attempt |

---

## Phase 1: Project Setup & Types

| Task | Description |
|------|-------------|
| 1.1 Install workflow package | `npm install workflow` |
| 1.2 Define core types | `DunningWorkflowInput`, `DunningConfig`, `InvoiceState`, `DunningResult` |
| 1.3 Create constants | Default config, retry schedule, email template definitions |

### Types

```typescript
// Workflow input
interface DunningWorkflowInput {
  provider: 'stripe';
  invoiceId: string;
  customerId: string;
  subscriptionId: string;
  config?: DunningConfig;
}

interface DunningConfig {
  retrySchedule?: string[];     // e.g., ["1d", "3d", "7d"]
  maxAttempts?: number;         // default: 3
  gracePeriod?: string;         // total grace period
  finalAction?: 'pause' | 'cancel' | 'mark_unpaid';
  restrictAccessAfterAttempt?: number; // e.g., 2
}

// Invoice state (from provider)
interface InvoiceState {
  id: string;
  status: 'open' | 'paid' | 'void' | 'uncollectible';
  amountDue: number;
  currency: string;
  nextPaymentAttempt?: Date;
  customerId: string;
  subscriptionId: string;
}

// Dunning result
interface DunningResult {
  invoiceId: string;
  outcome: 'recovered' | 'exhausted';
  finalAction?: string;
  attemptsUsed: number;
}
```

---

## Phase 2: Mock Providers

| Task | Description |
|------|-------------|
| 2.1 Mock Stripe provider | `getInvoice()`, `checkInvoiceStatus()` - supports `next_payment_attempt` hint |
| 2.2 Mock email service | `sendEmail()` with idempotency key support, logs all sent emails |
| 2.3 Mock subscription service | `pauseSubscription()`, `restrictAccess()` |
| 2.4 In-memory dunning store | Track invoice states, allow test manipulation |

### Mock Implementation Requirements

- Log all operations for observability
- Support idempotency (track calls by idempotency key)
- Allow external manipulation for testing (e.g., "mark invoice paid")
- Simulate realistic delays and occasional failures (for retry demo)

---

## Phase 3: Step Functions

| Task | Description |
|------|-------------|
| 3.1 `checkInvoiceStatus` | Fetch invoice state, use `FatalError` for 404 |
| 3.2 `sendDunningEmail` | Escalating email with `stepId` idempotency key, `RetryableError` for 429 |
| 3.3 `restrictCustomerAccess` | Idempotent access restriction |
| 3.4 `executeFinalAction` | Pause subscription with idempotency |
| 3.5 `respondToWebhook` | Send HTTP response when customer clicks fix link |

### Step Function Requirements

Each step must:
- Use `"use step"` directive
- Handle retries with `RetryableError` for transient failures (e.g., 429)
- Use `FatalError` for non-recoverable failures (e.g., 404 invoice not found)
- Pass `stepId` as idempotency key for side effects

---

## Phase 4: Core Workflow

| Task | Description |
|------|-------------|
| 4.1 Main workflow function | `subscriptionDunningWorkflow()` |
| 4.2 Create webhook with deterministic token | `createWebhook({ token: \`dunning:${invoiceId}\` })` |
| 4.3 Send initial notification | Include webhook URL as "fix payment" link |
| 4.4 Retry loop with `Promise.race` | `Promise.race([webhook, sleep(delay)])` |
| 4.5 Invoice status re-check | After each wait, check if paid -> exit recovered |
| 4.6 Escalating notifications | Send progressively urgent emails |
| 4.7 Access restriction | Restrict after threshold attempt |
| 4.8 Final action execution | Pause subscription when exhausted |

### Workflow Structure (Pseudocode)

```typescript
async function subscriptionDunningWorkflow(input: DunningWorkflowInput) {
  "use workflow";
  
  const config = { ...defaults, ...input.config };
  const webhook = createWebhook({ token: `dunning:${input.invoiceId}` });
  
  // Initial notification
  await sendDunningEmail(input, 0, webhook.url);
  
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    const delay = config.retrySchedule[attempt];
    
    // Race: customer fixes payment vs timeout
    await Promise.race([webhook, sleep(delay)]);
    
    // Check if paid
    const invoice = await checkInvoiceStatus(input.invoiceId);
    if (invoice.status === 'paid') {
      return { outcome: 'recovered', attemptsUsed: attempt + 1 };
    }
    
    // Escalate messaging
    if (attempt + 1 < config.maxAttempts) {
      await sendDunningEmail(input, attempt + 1, webhook.url);
    }
    
    // Restrict access after threshold
    if (attempt + 1 === config.restrictAccessAfterAttempt) {
      await restrictCustomerAccess(input.customerId);
    }
  }
  
  // Exhausted - execute final action
  await executeFinalAction(input, config.finalAction);
  return { outcome: 'exhausted', finalAction: config.finalAction };
}
```

---

## Phase 5: API Routes

| Task | Endpoint | Description |
|------|----------|-------------|
| 5.1 | `POST /api/webhooks/stripe` | Handle `invoice.payment_failed`, start workflow |
| 5.2 | `POST /api/dunning/start` | Manual workflow trigger for testing |
| 5.3 | `GET /api/dunning/[invoiceId]` | Get current dunning status |
| 5.4 | `POST /api/test/pay-invoice` | Mark invoice as paid (simulate recovery) |
| 5.5 | `GET /api/test/state` | View mock store state for debugging |

---

## Phase 6: Documentation & Testing

| Task | Description |
|------|-------------|
| 6.1 Example curl commands | Document all API endpoints with examples |
| 6.2 Inline code comments | Explain patterns, link to Workflow DevKit docs |
| 6.3 Test scenarios | Happy path, exhaustion, retry behavior, concurrent triggers |

---

## File Structure

```
workflows/
└── dunning/
    ├── index.ts          # Main workflow function
    ├── steps.ts          # All step functions
    ├── types.ts          # TypeScript interfaces
    └── constants.ts      # Defaults, schedules, templates

lib/
├── providers/
│   ├── stripe-mock.ts    # Mock Stripe API
│   └── email-mock.ts     # Mock email sender
├── services/
│   └── subscription.ts   # Mock subscription operations
└── store/
    └── dunning-store.ts  # In-memory state store

app/api/
├── webhooks/stripe/route.ts
├── dunning/
│   ├── start/route.ts
│   └── [invoiceId]/route.ts
└── test/
    ├── pay-invoice/route.ts
    └── state/route.ts
```

---

## Key Workflow DevKit Patterns Demonstrated

1. **Durable `sleep()`** - Multi-day delays without consuming resources
2. **`createWebhook()` with deterministic tokens** - External resumption for customer self-service
3. **`Promise.race()`** - Racing customer action vs timeout
4. **`getStepMetadata().stepId`** - Idempotency keys for side effects
5. **`RetryableError`** - Custom retry delays for rate limits (429)
6. **`FatalError`** - Skip retries for non-recoverable errors
7. **Step function pattern** - Full Node.js access, automatic retries

---

## References

- [Workflow DevKit: Workflows and Steps](https://useworkflow.dev/docs/foundations/workflows-and-steps)
- [Workflow DevKit: Control Flow Patterns](https://useworkflow.dev/docs/foundations/control-flow-patterns)
- [Workflow DevKit: createWebhook](https://useworkflow.dev/docs/api-reference/workflow/create-webhook)
- [Workflow DevKit: Errors & Retrying](https://useworkflow.dev/docs/foundations/errors-and-retries)
- [Workflow DevKit: Idempotency](https://useworkflow.dev/docs/foundations/idempotency)
- [Stripe: Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)
