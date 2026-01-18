# Dunning Workflow Specification

This document specifies the complete dunning workflow behavior and implementation.

## Overview

The dunning workflow handles failed subscription payments through:
1. Sending escalating reminder emails
2. Waiting for customer action via webhook or timeout
3. Checking invoice status after each wait period
4. Optionally restricting access after N failures
5. Executing a final action if all attempts are exhausted

## Workflow Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     dunningWorkflow(input)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Create deterministic webhook (token: dunning:{invoiceId})    │
│                                                                  │
│  2. Send initial dunning email (attempt 1)                       │
│                                                                  │
│  3. For each attempt (1 to maxAttempts):                        │
│     ┌──────────────────────────────────────────────────────┐    │
│     │  Promise.race([                                       │    │
│     │    webhook,           // Customer clicks "fix payment"│    │
│     │    sleep(delay)       // Timeout for this attempt     │    │
│     │  ])                                                   │    │
│     └──────────────────────────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│     ┌──────────────────────────────────────────────────────┐    │
│     │  checkInvoiceStatus(invoiceId)                        │    │
│     └──────────────────────────────────────────────────────┘    │
│                           │                                      │
│           ┌───────────────┴───────────────┐                     │
│           │                               │                      │
│      status: 'paid'              status: not 'paid'             │
│           │                               │                      │
│           ▼                               ▼                      │
│     Return 'recovered'    ┌─────────────────────────────┐       │
│                           │ If attempt >= restrictAfter │       │
│                           │   restrictCustomerAccess()  │       │
│                           └─────────────────────────────┘       │
│                                          │                       │
│                           ┌─────────────────────────────┐       │
│                           │ If attempt < maxAttempts    │       │
│                           │   sendDunningEmail()        │       │
│                           └─────────────────────────────┘       │
│                                                                  │
│  4. After loop exhausted:                                        │
│     executeFinalAction() → Return 'exhausted'                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Input/Output Types

### Input

```typescript
interface DunningWorkflowInput {
  provider: string;           // 'stripe'
  invoiceId: string;          // Invoice ID from billing provider
  customerId: string;         // Customer ID
  subscriptionId: string;     // Subscription ID
  config?: DunningConfig;     // Optional configuration overrides
}

interface DunningConfig {
  retrySchedule?: string[];              // ['1d', '3d', '7d']
  maxAttempts?: number;                  // 3
  finalAction?: 'pause' | 'cancel' | 'mark_unpaid';  // 'pause'
  restrictAccessAfterAttempt?: number;   // 2
}
```

### Output

```typescript
interface DunningResult {
  invoiceId: string;
  outcome: 'recovered' | 'exhausted';
  finalAction?: 'pause' | 'cancel' | 'mark_unpaid';  // Only if exhausted
  attemptsUsed: number;
}
```

## Correct Implementation

```typescript
import { createWebhook, sleep } from 'workflow';
import type { DunningWorkflowInput, DunningResult } from './types';
import { checkInvoiceStatus } from './steps/check-invoice-status';
import { sendDunningEmail } from './steps/send-dunning-email';
import { restrictCustomerAccess } from './steps/restrict-access';
import { executeFinalAction } from './steps/execute-final-action';
import { parseDuration } from './utils/duration';

export async function dunningWorkflow(input: DunningWorkflowInput): Promise<DunningResult> {
  "use workflow";  // CRITICAL: Inside function body
  
  const { invoiceId, customerId, subscriptionId, config: userConfig } = input;
  const config = mergeConfig(userConfig);
  
  // Create deterministic webhook for customer action
  const webhook = createWebhook({ token: `dunning:${invoiceId}` });
  
  // Get customer email (would be from customer data in production)
  const customerEmail = `${customerId}@example.com`;
  
  // Send initial dunning email
  await sendDunningEmail({
    to: customerEmail,
    customerId,
    invoiceId,
    attemptNumber: 1,
    webhookUrl: webhook.url,
    maxAttempts: config.maxAttempts,
  });
  
  let attemptsUsed = 1;
  
  // Retry loop
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const delay = config.retrySchedule[attempt - 1] 
      || config.retrySchedule[config.retrySchedule.length - 1];
    
    // Race: customer webhook vs timeout
    await Promise.race([
      webhook,
      sleep(parseDuration(delay)),
    ]);
    
    // Check invoice status
    const invoiceState = await checkInvoiceStatus(invoiceId);
    
    // Recovery path
    if (invoiceState.status === 'paid') {
      return {
        invoiceId,
        outcome: 'recovered',
        attemptsUsed,
      };
    }
    
    // Restrict access if threshold reached
    if (attempt >= config.restrictAccessAfterAttempt) {
      await restrictCustomerAccess({
        customerId,
        invoiceId,
        subscriptionId,
      });
    }
    
    // Send escalating email if more attempts remain
    if (attempt < config.maxAttempts) {
      attemptsUsed++;
      await sendDunningEmail({
        to: customerEmail,
        customerId,
        invoiceId,
        attemptNumber: attemptsUsed,
        webhookUrl: webhook.url,
        maxAttempts: config.maxAttempts,
      });
    }
  }
  
  // Execute final action
  await executeFinalAction({
    action: config.finalAction,
    subscriptionId,
    invoiceId,
    customerId,
  });
  
  return {
    invoiceId,
    outcome: 'exhausted',
    finalAction: config.finalAction,
    attemptsUsed,
  };
}
```

## Webhook Behavior

The webhook allows customers to trigger early payment status check:

1. Webhook URL is included in dunning emails
2. When customer clicks link, webhook resolves
3. `Promise.race` completes immediately
4. Workflow checks invoice status
5. If paid, workflow exits with 'recovered'

The webhook token is deterministic (`dunning:{invoiceId}`) so:
- Same URL across workflow restarts
- Customer can use the link even if workflow restarts

## Default Configuration

```typescript
const DEFAULT_RETRY_SCHEDULE = ['1d', '3d', '7d'];
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_FINAL_ACTION = 'pause';
const DEFAULT_RESTRICT_ACCESS_AFTER_ATTEMPT = 2;
```

## Test Scenarios

### Scenario 1: Early Recovery (Attempt 1)
- Start workflow
- Customer pays before first timeout
- Webhook triggers, status check shows 'paid'
- **Expected**: `{ outcome: 'recovered', attemptsUsed: 1 }`

### Scenario 2: Recovery After Access Restriction (Attempt 2)
- Start workflow
- First timeout expires
- Customer pays during second wait period
- Access was restricted (attempt >= 2)
- **Expected**: `{ outcome: 'recovered', attemptsUsed: 2 }`, customer was restricted

### Scenario 3: Exhausted with Pause
- Start workflow
- All timeouts expire without payment
- **Expected**: `{ outcome: 'exhausted', finalAction: 'pause', attemptsUsed: 3 }`

### Scenario 4: Exhausted with Cancel
- Start workflow with `config: { finalAction: 'cancel' }`
- All timeouts expire without payment
- **Expected**: `{ outcome: 'exhausted', finalAction: 'cancel', attemptsUsed: 3 }`

## Verification Checklist

- [ ] `"use workflow"` directive inside function body
- [ ] No direct I/O in workflow function
- [ ] Webhook created with deterministic token
- [ ] All side effects in step functions
- [ ] Correct Promise.race pattern for webhook/timeout
- [ ] Access restriction at correct threshold
- [ ] Final action executed only when exhausted
