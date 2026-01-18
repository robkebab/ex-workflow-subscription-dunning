# Implementation Plan: Workflow Pattern Fixes

This document tracks issues with the current dunning workflow implementation that violate Vercel Workflow DevKit patterns. Issues are sorted by priority.

---

## CRITICAL: Directive Placement (Compiler Requirement)

All `"use workflow"` and `"use step"` directives are incorrectly placed at file level instead of inside function bodies. This prevents the compiler from transforming the functions for durable execution.

Per the Workflow DevKit documentation:
> Directives must be placed as the first statement inside the function body, not at the file level.

### Issues

- [x] **`lib/dunning/workflow.ts`** - `"use workflow"` ~~at file level~~, moved inside `dunningWorkflow()` function body ✓
- [x] **`lib/dunning/steps/check-invoice-status.ts`** - `"use step"` ~~at file level~~, moved inside `checkInvoiceStatus()` function body ✓
- [x] **`lib/dunning/steps/send-dunning-email.ts`** - `"use step"` ~~at file level~~, moved inside `sendDunningEmail()` function body ✓
- [x] **`lib/dunning/steps/restrict-access.ts`** - `"use step"` ~~at file level~~, moved inside `restrictCustomerAccess()` function body ✓
- [ ] **`lib/dunning/steps/execute-final-action.ts:13`** - `"use step"` at file level, must move inside `executeFinalAction()` function body

---

## CRITICAL: Determinism Violation (Breaks Replay)

Workflow functions must be deterministic. All I/O operations must go through step functions, not be called directly in workflow context.

### Issues

- [ ] **`lib/dunning/workflow.ts:80-83`** - Direct store access in workflow:
  ```typescript
  const storedInvoice = dunningStore.getInvoice(invoiceId);
  if (!storedInvoice) {
    dunningStore.createInvoice(invoiceId, customerId, subscriptionId);
  }
  ```
  **Fix**: Move this to a step function (e.g., `ensureInvoiceExists`) or remove if not needed (the invoice should exist before dunning starts).

---

## HIGH: Incorrect Workflow Triggering

API routes call the workflow function directly instead of using `start()` from `workflow/api`. This bypasses the workflow runtime, losing durability, observability, and proper Run management.

### Issues

- [ ] **`app/api/dunning/start/route.ts:132`** - Calls `dunningWorkflow(workflowInput)` directly
  **Fix**: Use `start()` from `workflow/api`:
  ```typescript
  import { start } from "workflow/api";
  const run = await start(dunningWorkflow, [workflowInput]);
  ```

- [ ] **`app/api/webhooks/stripe/route.ts:141`** - Calls `dunningWorkflow(workflowInput)` directly
  **Fix**: Same as above - use `start()` from `workflow/api`

- [ ] **Manual runId generation** - Both routes generate their own runIds instead of using `run.runId` from the Run object returned by `start()`

- [ ] **Manual state tracking** - Both routes manually update `dunningStore` for workflow state when the Run object already provides `status`, `returnValue`, etc.

---

## MEDIUM: Missing Step Configuration

Step functions should configure `maxRetries` for critical operations and use exponential backoff.

### Issues

- [ ] **`lib/dunning/steps/check-invoice-status.ts`** - Missing `maxRetries` configuration
- [ ] **`lib/dunning/steps/send-dunning-email.ts`** - Missing `maxRetries` configuration
- [ ] **`lib/dunning/steps/restrict-access.ts`** - Missing `maxRetries` configuration
- [ ] **`lib/dunning/steps/execute-final-action.ts`** - Missing `maxRetries` configuration

**Fix pattern**:
```typescript
export async function checkInvoiceStatus(invoiceId: string): Promise<InvoiceState> {
  "use step";
  // ... implementation
}
checkInvoiceStatus.maxRetries = 5;
```

### Exponential Backoff

- [ ] Step functions use fixed retry delays. Consider implementing exponential backoff using `getStepMetadata().attempt`:
  ```typescript
  const { attempt } = getStepMetadata();
  const delay = Math.min((attempt ** 2) * 1000, 60000);
  throw new RetryableError('...', { retryAfter: delay });
  ```

---

## Summary

| Priority | Category | Count |
|----------|----------|-------|
| CRITICAL | Directive Placement | 1 remaining |
| CRITICAL | Determinism | 1 |
| HIGH | Workflow Triggering | 4 |
| MEDIUM | Step Configuration | 5 |
| **Total** | | **11** |

---

## Recommended Fix Order

1. Fix directive placement in all files (CRITICAL - nothing works without this)
2. Fix determinism violation in workflow.ts (CRITICAL - breaks replay)
3. Update API routes to use `start()` (HIGH - enables proper runtime)
4. Add `maxRetries` and exponential backoff (MEDIUM - improves reliability)
