# Workflow Determinism Specification

This document specifies determinism requirements for workflow functions.

## Overview

Workflow functions run in a sandboxed environment and must be deterministic to support replay. When a workflow resumes after suspension, it re-executes from the beginning using cached step results.

## Critical Requirements

### No Direct I/O in Workflows

Workflow functions CANNOT perform I/O operations directly. All I/O must go through step functions.

#### What CAN happen in workflows:
- Control flow (if/else, loops, try/catch)
- Calling step functions
- Using workflow primitives (`sleep`, `createHook`, `createWebhook`)
- Basic computation on serialized data

#### What MUST happen in steps:
- HTTP requests
- Database operations
- File system access
- External API calls
- Store operations
- Sending emails/notifications

### Current Violation

**File:** `lib/dunning/workflow.ts` (lines 80-83)

```typescript
// WRONG: Direct store access in workflow context
const storedInvoice = dunningStore.getInvoice(invoiceId);
if (!storedInvoice) {
  dunningStore.createInvoice(invoiceId, customerId, subscriptionId);
}
```

### Correct Pattern

Option 1: Remove the store check (invoice should exist before dunning starts)

```typescript
export async function dunningWorkflow(input: DunningWorkflowInput): Promise<DunningResult> {
  "use workflow";
  
  // Invoice must exist before workflow starts - no store check needed
  const webhook = createWebhook({ token: `dunning:${input.invoiceId}` });
  // ...
}
```

Option 2: Move to a step function

```typescript
// In a step file
export async function ensureInvoiceExists(
  invoiceId: string,
  customerId: string,
  subscriptionId: string
): Promise<void> {
  "use step";
  
  const existing = dunningStore.getInvoice(invoiceId);
  if (!existing) {
    dunningStore.createInvoice(invoiceId, customerId, subscriptionId);
  }
}

// In workflow
export async function dunningWorkflow(input: DunningWorkflowInput): Promise<DunningResult> {
  "use workflow";
  
  await ensureInvoiceExists(input.invoiceId, input.customerId, input.subscriptionId);
  // ...
}
```

## Non-Deterministic Operations

Avoid these in workflow context:

| Operation | Problem | Solution |
|-----------|---------|----------|
| `Math.random()` | Different value on replay | Generate in step function |
| `Date.now()` | Different value on replay | Use sandbox-provided Date or generate in step |
| `crypto.randomUUID()` | Different value on replay | Generate in step function |
| Direct `fetch()` | Side effect, non-deterministic | Move to step function |
| Database queries | Side effect | Move to step function |
| File system access | Side effect | Move to step function |

## Control Flow

Control flow is safe in workflows when deterministic:

```typescript
export async function dunningWorkflow(input: DunningWorkflowInput): Promise<DunningResult> {
  "use workflow";
  
  // SAFE: Loops based on input/config
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    // SAFE: Step function call
    const status = await checkInvoiceStatus(input.invoiceId);
    
    // SAFE: Conditional based on step result
    if (status.status === 'paid') {
      return { outcome: 'recovered', /* ... */ };
    }
    
    // SAFE: Workflow primitive
    await sleep(config.retrySchedule[attempt - 1]);
  }
  
  return { outcome: 'exhausted', /* ... */ };
}
```

## Verification Checklist

- [ ] No `dunningStore` calls directly in workflow function
- [ ] No `fetch()` calls directly in workflow function
- [ ] No file system operations in workflow function
- [ ] No `Math.random()` or `Date.now()` for business logic in workflow
- [ ] All external interactions wrapped in step functions
