# Workflow Directives Specification

This document specifies the correct usage of workflow directives in the dunning application.

## Overview

The Vercel Workflow DevKit uses two directives to mark functions for special handling:
- `"use workflow"` - Marks orchestration functions
- `"use step"` - Marks side-effect functions

## Critical Requirements

### Directive Placement

Directives MUST be placed as the **first statement inside the function body**, not at file level.

#### Incorrect

```typescript
// File: workflow.ts
"use workflow";  // WRONG: At file level

export async function dunningWorkflow(input: DunningWorkflowInput) {
  // ...
}
```

#### Correct

```typescript
// File: workflow.ts
export async function dunningWorkflow(input: DunningWorkflowInput) {
  "use workflow";  // CORRECT: Inside function body
  
  // ...
}
```

### Async Requirement

All workflow and step functions MUST be declared as `async`.

```typescript
// CORRECT
export async function checkInvoiceStatus(invoiceId: string) {
  "use step";
  // ...
}

// WRONG - will not compile
export function checkInvoiceStatus(invoiceId: string) {
  "use step";
  // ...
}
```

## Application Files

### Main Workflow

**File:** `lib/dunning/workflow.ts`

```typescript
export async function dunningWorkflow(input: DunningWorkflowInput): Promise<DunningResult> {
  "use workflow";
  
  // Orchestration logic only - no direct I/O
  const webhook = createWebhook({ token: `dunning:${input.invoiceId}` });
  
  await sendDunningEmail({ /* ... */ });
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    await Promise.race([webhook, sleep(delay)]);
    const status = await checkInvoiceStatus(input.invoiceId);
    // ...
  }
  
  return result;
}
```

### Step Functions

**File:** `lib/dunning/steps/check-invoice-status.ts`

```typescript
export async function checkInvoiceStatus(invoiceId: string): Promise<InvoiceState> {
  "use step";
  
  const { attempt } = getStepMetadata();
  // ... I/O operations
}

checkInvoiceStatus.maxRetries = 5;
```

**File:** `lib/dunning/steps/send-dunning-email.ts`

```typescript
export async function sendDunningEmail(options: SendDunningEmailOptions): Promise<SendDunningEmailResult> {
  "use step";
  
  const { stepId } = getStepMetadata();
  // ... email sending with idempotency key
}

sendDunningEmail.maxRetries = 3;
```

**File:** `lib/dunning/steps/restrict-access.ts`

```typescript
export async function restrictCustomerAccess(options: RestrictAccessOptions): Promise<RestrictAccessResult> {
  "use step";
  
  const { stepId } = getStepMetadata();
  // ... access restriction
}

restrictCustomerAccess.maxRetries = 3;
```

**File:** `lib/dunning/steps/execute-final-action.ts`

```typescript
export async function executeFinalAction(options: ExecuteFinalActionOptions): Promise<ExecuteFinalActionResult> {
  "use step";
  
  const { stepId } = getStepMetadata();
  // ... final action execution
}

executeFinalAction.maxRetries = 5;
```

## Verification

To verify correct directive placement:

1. Each workflow/step function should have the directive as its first statement
2. No directives should appear at file level (outside any function)
3. All marked functions must be `async`
