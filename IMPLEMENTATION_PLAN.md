# Subscription Dunning Workflow - Implementation Plan

This document tracks the implementation of a production-leaning subscription dunning workflow using Workflow DevKit. Items are sorted by priority and dependency order.

---

## Phase 1: Foundation (Dependencies & Types)

### 1.1 Install Workflow DevKit
- [x] Add `workflow` package to dependencies (Vercel's Workflow DevKit at useworkflow.dev)
- [x] Configure `next.config.ts` with `withWorkflow()` wrapper
- [x] Verify build succeeds with workflow routes
- **Status:** Complete
- **Notes:** The package is `workflow` (not `@anthropic-ai/workflow-devkit`). It adds `/.well-known/workflow/v1/*` routes.

### 1.2 Install Test Framework
- [x] Add Vitest to devDependencies
- [x] Configure vitest.config.ts with path aliases
- [x] Add test scripts to package.json (test, test:watch, test:coverage)
- **Status:** Complete

### 1.3 Implement Types & Configuration (`lib/dunning/types.ts`)
- [x] Define `DunningWorkflowInput` interface
- [x] Define `DunningConfig` interface with optional fields
- [x] Define `InvoiceState` interface
- [x] Define `DunningResult` interface
- [x] Export `DEFAULT_RETRY_SCHEDULE` constant: `["1d", "3d", "7d"]`
- [x] Export `DEFAULT_MAX_ATTEMPTS` constant: `3`
- [x] Export `DEFAULT_FINAL_ACTION` constant: `'pause'`
- [x] Export `DEFAULT_RESTRICT_ACCESS_AFTER_ATTEMPT` constant: `2`
- [x] Define `EmailEscalationLevel` type (levels 0, 1, 2)
- [x] Create test to verify all types and constants are importable (13 tests passing)
- **Status:** Complete
- **Spec:** `specs/types-configuration.md`

---

## Phase 2: Mock Infrastructure

### 2.1 Implement In-Memory Dunning Store (`lib/dunning/store.ts`)
- [x] Create `DunningStore` class with invoice state tracking
- [x] Implement `getInvoice(invoiceId)` method
- [x] Implement `setInvoiceStatus(invoiceId, status)` method
- [x] Implement `markInvoicePaid(invoiceId)` method for test manipulation
- [x] Implement `reset()` method for test isolation
- [x] Track workflow runs and their states
- [x] Support concurrent access patterns
- [x] Add logging for observability
- **Status:** Complete (43 tests)
- **Spec:** `specs/mock-providers.md`

### 2.2 Implement Mock Stripe Provider (`lib/dunning/providers/stripe.ts`)
- [x] Implement `getInvoice(invoiceId)` returning `InvoiceState`
- [x] Implement `checkInvoiceStatus(invoiceId)` returning status
- [x] Support `next_payment_attempt` hint for testing
- [x] Simulate occasional 429 rate limit responses (configurable)
- [x] Simulate configurable latency (50-200ms)
- [x] Log all operations for debugging
- **Status:** Complete (19 tests)
- **Spec:** `specs/mock-providers.md`

### 2.3 Implement Mock Email Service (`lib/dunning/providers/email.ts`)
- [x] Implement `sendEmail(options)` with idempotency key support
- [x] Accept escalation level, webhook URL, and customer details
- [x] Log all sent emails with timestamp and content summary
- [x] Track calls by idempotency key to prevent duplicates
- [x] Simulate occasional transient failures (retry-able)
- **Status:** Complete (14 tests)
- **Spec:** `specs/mock-providers.md`

### 2.4 Implement Mock Subscription Service (`lib/dunning/providers/subscription.ts`)
- [x] Implement `pauseSubscription(subscriptionId)` - idempotent
- [x] Implement `cancelSubscription(subscriptionId)` - idempotent
- [x] Implement `restrictAccess(customerId)` - idempotent
- [x] Implement `markUnpaid(invoiceId)` - idempotent (added for mark_unpaid action)
- [x] Track operations by idempotency key
- [x] Log all operations
- **Status:** Complete (13 tests)
- **Spec:** `specs/mock-providers.md`

### 2.5 Mock Provider Tests
- [x] Test mock Stripe returns invoice state correctly
- [x] Test mock Stripe 429 simulation
- [x] Test mock email logs and respects idempotency
- [x] Test subscription operations are idempotent
- [x] Test store allows external state manipulation
- [x] Test retry behavior on transient failures
- **Status:** Complete (89 tests total across all mock providers)
- **Spec:** `specs/mock-providers.md`

---

## Phase 3: Step Functions

### 3.1 Implement checkInvoiceStatus Step (`lib/dunning/steps/check-invoice-status.ts`)
- [x] Use `"use step"` directive
- [x] Fetch invoice state from mock Stripe provider
- [x] Throw `FatalError` for 404 (invoice not found)
- [x] Throw `RetryableError` for transient failures (5xx, network, rate limits)
- [x] Return `InvoiceState`
- [x] Add test for success path (2 tests)
- [x] Add test for 404 FatalError (2 tests)
- [x] Add test for retry behavior on transient failure (4 tests)
- [x] Add edge case test for nextPaymentAttempt field
- **Status:** Complete (9 tests)
- **Spec:** `specs/step-functions.md`
- **Notes:** Uses `getStepMetadata()` for logging stepId and attempt number. Handles InvoiceNotFoundError, RateLimitError, and TransientError from mock Stripe provider.

### 3.2 Implement sendDunningEmail Step (`lib/dunning/steps/send-dunning-email.ts`)
- [x] Use `"use step"` directive
- [x] Accept attempt number to determine escalation level
- [x] Include webhook URL as "fix payment" link
- [x] Use `stepId` from `getStepMetadata()` as idempotency key
- [x] Throw `RetryableError` for transient failures with delay hint
- [x] Throw `FatalError` for non-recoverable failures
- [x] Add test for successful send (2 tests)
- [x] Add test for escalation levels (4 tests)
- [x] Add test for idempotency (2 tests)
- [x] Add test for retry on transient failure (3 tests)
- [x] Add test for webhook URL inclusion (1 test)
- **Status:** Complete (12 tests)
- **Spec:** `specs/step-functions.md`
- **Notes:** Maps attempt numbers to escalation levels (1→0, 2→1, 3+→2). Uses stepId as idempotency key to prevent duplicate emails.

### 3.3 Implement restrictCustomerAccess Step (`lib/dunning/steps/restrict-access.ts`)
- [ ] Use `"use step"` directive
- [ ] Mark customer as access-restricted via subscription service
- [ ] Use `stepId` as idempotency key
- [ ] Must be idempotent (safe to call multiple times)
- [ ] Add test for successful restriction
- [ ] Add test for idempotency
- **Status:** Not started
- **Spec:** `specs/step-functions.md`

### 3.4 Implement executeFinalAction Step (`lib/dunning/steps/execute-final-action.ts`)
- [ ] Use `"use step"` directive
- [ ] Accept `finalAction` config (`'pause'` | `'cancel'` | `'mark_unpaid'`)
- [ ] Execute configured action via subscription service
- [ ] Use `stepId` as idempotency key
- [ ] Must be idempotent
- [ ] Add test for pause action
- [ ] Add test for cancel action
- [ ] Add test for mark_unpaid action
- [ ] Add test for idempotency
- **Status:** Not started
- **Spec:** `specs/step-functions.md`

---

## Phase 4: Core Workflow

### 4.1 Implement Duration Parser Utility (`lib/dunning/utils/duration.ts`)
- [ ] Parse delay strings like "1d", "3d", "7d" to milliseconds
- [ ] Support days (d), hours (h), minutes (m), seconds (s)
- [ ] Add test for all supported formats
- **Status:** Not started
- **Spec:** Implied by `specs/types-configuration.md` (retrySchedule uses delay strings)

### 4.2 Implement Main Dunning Workflow (`lib/dunning/workflow.ts`)
- [ ] Use `"use workflow"` directive at function start
- [ ] Accept `DunningWorkflowInput` as parameter
- [ ] Merge input config with defaults
- [ ] Create webhook with deterministic token: `dunning:${invoiceId}`
- [ ] Send initial dunning email with webhook URL
- [ ] Implement retry loop for each attempt up to `maxAttempts`:
  - [ ] `Promise.race([webhook, sleep(delay)])` - race customer action vs timeout
  - [ ] After race resolves, call `checkInvoiceStatus` step
  - [ ] If paid: return `{ outcome: 'recovered', invoiceId, attemptsUsed }`
  - [ ] If not paid and at `restrictAccessAfterAttempt`: call `restrictCustomerAccess`
  - [ ] If not paid and more attempts remain: send escalating email
- [ ] When all attempts exhausted:
  - [ ] Call `executeFinalAction` step
  - [ ] Return `{ outcome: 'exhausted', invoiceId, attemptsUsed, finalAction }`
- **Status:** Not started
- **Spec:** `specs/core-workflow.md`

### 4.3 Core Workflow Tests
- [ ] Test workflow uses `"use workflow"` directive
- [ ] Test webhook created with deterministic token
- [ ] Test Promise.race correctly races webhook vs sleep
- [ ] Test invoice status checked after each wait
- [ ] Test returns `recovered` when invoice paid mid-dunning
- [ ] Test returns `exhausted` with final action after all attempts
- [ ] Test access restriction triggers at correct attempt
- [ ] Test full happy path (recovery on first attempt)
- [ ] Test full recovery path (recovery on attempt 2)
- [ ] Test exhaustion path (all attempts fail)
- **Status:** Not started
- **Spec:** `specs/core-workflow.md`

---

## Phase 5: API Endpoints

### 5.1 Implement Stripe Webhook Endpoint (`app/api/webhooks/stripe/route.ts`)
- [ ] Handle POST requests
- [ ] Parse `invoice.payment_failed` event from request body
- [ ] Extract `data.object.id`, `data.object.customer`, `data.object.subscription`
- [ ] Validate payload structure (return 400 on malformed)
- [ ] Start dunning workflow with extracted data (asynchronously)
- [ ] Implement idempotency: same event ID should not start duplicate workflows
- [ ] Return 200 quickly after starting workflow
- [ ] Log received events for observability
- [ ] Add comment noting webhook signature verification skipped for demo
- [ ] Add test for successful event processing
- [ ] Add test for 400 on malformed payload
- [ ] Add test for idempotency
- **Status:** Not started
- **Spec:** `specs/webhook-api.md`

### 5.2 Implement Dunning Start Endpoint (`app/api/dunning/start/route.ts`)
- [ ] Handle POST requests
- [ ] Accept `invoiceId`, `customerId`, `subscriptionId` in request body
- [ ] Accept optional `config` overrides in request body
- [ ] Validate required fields
- [ ] Start dunning workflow with provided data
- [ ] Return workflow run ID or confirmation
- [ ] Add test for successful trigger
- **Status:** Not started
- **Spec:** `specs/test-api.md`

### 5.3 Implement Dunning Status Endpoint (`app/api/dunning/[invoiceId]/route.ts`)
- [ ] Handle GET requests
- [ ] Get current dunning status for invoice from store
- [ ] Return attempt count, current state, timestamps
- [ ] Return 404 if no dunning in progress for invoice
- [ ] Add test for status retrieval
- [ ] Add test for 404 case
- **Status:** Not started
- **Spec:** `specs/test-api.md`

### 5.4 Implement Pay Invoice Test Endpoint (`app/api/test/pay-invoice/route.ts`)
- [ ] Handle POST requests
- [ ] Accept `invoiceId` in request body
- [ ] Update mock store to mark invoice as paid
- [ ] Return confirmation
- [ ] Add test demonstrating recovery path
- **Status:** Not started
- **Spec:** `specs/test-api.md`

### 5.5 Implement State Dump Endpoint (`app/api/test/state/route.ts`)
- [ ] Handle GET requests
- [ ] Return full mock store state as JSON
- [ ] Include all invoices, email logs, subscription states
- [ ] Add test for state inspection
- **Status:** Not started
- **Spec:** `specs/test-api.md`

---

## Phase 6: Integration & End-to-End Tests

### 6.1 Integration Tests
- [ ] Test triggering workflow via /api/dunning/start
- [ ] Test simulating payment recovery via /api/test/pay-invoice
- [ ] Test full flow: webhook → workflow → recovery
- [ ] Test full flow: webhook → workflow → exhaustion
- **Status:** Not started
- **Spec:** Various

### 6.2 Documentation
- [ ] Update AGENTS.md with build & run commands
- [ ] Update AGENTS.md with validation commands
- [ ] Ensure README has project-specific instructions
- **Status:** Not started

---

## Summary

**Total Items:** 76 tasks across 6 phases
**Completed:** Phase 1 (Foundation), Phase 2 (Mock Infrastructure), Phase 3.1-3.2 (checkInvoiceStatus, sendDunningEmail Steps) - 110 tests passing
**In Progress:** Phase 3 (Step Functions) - 3.1-3.2 complete, 3.3-3.4 remaining
**Remaining:** Phases 3.3-3.4, 4, 5, 6

### Dependency Order
1. **Phase 1** must complete before other phases (types and test framework are foundational)
2. **Phase 2** (mocks) must complete before Phase 3 (step functions rely on mocks)
3. **Phase 3** (steps) must complete before Phase 4 (workflow orchestrates steps)
4. **Phase 4** (workflow) must complete before Phase 5 (APIs trigger workflows)
5. **Phase 5** and **Phase 6** can proceed in parallel

### Key Architecture Decisions
- All shared code lives in `lib/dunning/`
- Mock providers are in `lib/dunning/providers/`
- Step functions are in `lib/dunning/steps/`
- API routes follow Next.js App Router conventions in `app/api/`
- Tests live alongside source files or in `__tests__/` directories
- Deterministic webhook token format: `dunning:${invoiceId}`
- Duration strings parsed from human-readable format: "1d", "3d", "7d"
