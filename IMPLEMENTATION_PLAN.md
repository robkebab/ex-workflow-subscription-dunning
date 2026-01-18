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
- [x] **`lib/dunning/steps/execute-final-action.ts`** - `"use step"` ~~at file level~~, moved inside `executeFinalAction()` function body ✓

---

## CRITICAL: Determinism Violation (Breaks Replay)

Workflow functions must be deterministic. All I/O operations must go through step functions, not be called directly in workflow context.

### Issues

- [x] **`lib/dunning/workflow.ts`** - ~~Direct store access in workflow~~ Removed `dunningStore.getInvoice()` and `dunningStore.createInvoice()` calls from workflow function. Invoice must exist before workflow starts (created by API route or test setup). ✓

---

## HIGH: Incorrect Workflow Triggering

API routes call the workflow function directly instead of using `start()` from `workflow/api`. This bypasses the workflow runtime, losing durability, observability, and proper Run management.

### Issues

- [x] **`app/api/dunning/start/route.ts`** - ~~Calls `dunningWorkflow(workflowInput)` directly~~ Now uses `start()` from `workflow/api` and gets `runId` from the returned `Run` object. ✓

- [x] **`app/api/webhooks/stripe/route.ts`** - ~~Calls `dunningWorkflow(workflowInput)` directly~~ Now uses `start()` from `workflow/api` and gets `runId` from the returned `Run` object. ✓

- [ ] **Manual state tracking** - Both routes manually update `dunningStore` for workflow state when the Run object already provides `status`, `returnValue`, etc. (Note: Both routes now use `run.returnValue` promise but still update local store for backward compatibility with status endpoint)

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
| CRITICAL | Directive Placement | ✅ Complete |
| CRITICAL | Determinism | ✅ Complete |
| HIGH | Workflow Triggering | 1 remaining (2 done) |
| MEDIUM | Step Configuration | 5 |
| **Total Remaining** | | **6** |

---

## Recommended Fix Order

1. ~~Fix directive placement in all files~~ ✅ Complete
2. ~~Fix determinism violation in workflow.ts~~ ✅ Complete
3. ~~Update `app/api/dunning/start/route.ts` to use `start()`~~ ✅ Complete
4. ~~Update `app/api/webhooks/stripe/route.ts` to use `start()`~~ ✅ Complete
5. Add `maxRetries` and exponential backoff (MEDIUM - improves reliability)
