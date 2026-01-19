# Implementation Plan: Workflow Pattern Fixes

This document tracks issues with the current dunning workflow implementation that violate Vercel Workflow DevKit patterns.

---

## Summary

All issues have been resolved. The implementation now follows Vercel Workflow DevKit patterns correctly.

| Priority | Category | Status |
|----------|----------|--------|
| CRITICAL | Directive Placement | ✅ Complete |
| CRITICAL | Determinism | ✅ Complete |
| HIGH | Workflow Triggering | ✅ Complete |
| MEDIUM | Step Configuration (maxRetries) | ✅ Complete |
| MEDIUM | Exponential Backoff | ✅ Complete |

---

## Completed Items

### CRITICAL: Directive Placement ✅

`"use workflow"` and `"use step"` directives are now correctly placed inside function bodies (not at file level).

- `lib/dunning/workflow.ts` - `"use workflow"` inside `dunningWorkflow()` function body
- `lib/dunning/steps/check-invoice-status.ts` - `"use step"` inside `checkInvoiceStatus()` function body
- `lib/dunning/steps/send-dunning-email.ts` - `"use step"` inside `sendDunningEmail()` function body
- `lib/dunning/steps/restrict-access.ts` - `"use step"` inside `restrictCustomerAccess()` function body
- `lib/dunning/steps/execute-final-action.ts` - `"use step"` inside `executeFinalAction()` function body

### CRITICAL: Determinism ✅

Workflow functions are now deterministic - no direct I/O in workflow context.

- `lib/dunning/workflow.ts` - Removed direct `dunningStore` access. Invoice must exist before workflow starts.

### HIGH: Workflow Triggering ✅

API routes now use `start()` from `workflow/api` and leverage the Run object for status management.

- `app/api/dunning/start/route.ts` - Uses `start()` from `workflow/api`
- `app/api/webhooks/stripe/route.ts` - Uses `start()` from `workflow/api`
- `app/api/dunning/[invoiceId]/route.ts` - Uses `getRun()` from `workflow/api` for real-time status

**Architecture changes:**
- Routes store minimal `invoiceId` → `runId` mapping via `dunningStore.setInvoiceRunMapping()`
- Status endpoint uses `getRun()` to fetch status/returnValue from the runtime
- Removed manual workflow state tracking (`state`, `outcome`, `finalAction`, etc.)
- The workflow runtime is now the single source of truth for workflow state

### MEDIUM: Step Configuration ✅

All step functions have `maxRetries` configured:

- `check-invoice-status.ts` - `maxRetries = 5`
- `send-dunning-email.ts` - `maxRetries = 3`
- `restrict-access.ts` - `maxRetries = 3`
- `execute-final-action.ts` - `maxRetries = 5`

### MEDIUM: Exponential Backoff ✅

Exponential backoff implemented for transient errors:

- `check-invoice-status.ts` - Uses `(attempt ** 2) * 1000` capped at 60000ms
- `send-dunning-email.ts` - Uses `(attempt ** 2) * 1000` capped at 30000ms

Note: `restrict-access.ts` and `execute-final-action.ts` throw `FatalError` for unexpected errors (no transient error types defined).
