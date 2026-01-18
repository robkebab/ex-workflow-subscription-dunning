# Step Functions

Implement durable step functions for individual dunning operations using Workflow DevKit patterns.

## Job to Be Done

Create atomic, retry-safe step functions that handle transient failures and use idempotency keys for side effects.

## Required Step Functions

### checkInvoiceStatus
- Fetch current invoice state from provider
- Use `FatalError` for 404 (invoice not found)
- Use `RetryableError` for transient failures

### sendDunningEmail
- Send escalating email based on attempt number
- Include webhook URL as "fix payment" link
- Use `stepId` from `getStepMetadata()` as idempotency key
- Use `RetryableError` for 429 rate limits with appropriate delay

### restrictCustomerAccess
- Mark customer as access-restricted
- Must be idempotent (safe to call multiple times)
- Use `stepId` as idempotency key

### executeFinalAction
- Execute configured final action (pause subscription)
- Must be idempotent
- Use `stepId` as idempotency key

## Workflow DevKit Patterns

Each step function must:
- Use `"use step"` directive
- Handle transient errors with `RetryableError`
- Handle non-recoverable errors with `FatalError`
- Pass `stepId` as idempotency key for side effects
- Have full Node.js access for external calls

## Acceptance Criteria

- [ ] All steps use `"use step"` directive
- [ ] checkInvoiceStatus throws FatalError on 404
- [ ] sendDunningEmail uses stepId for idempotency
- [ ] RetryableError used for 429 responses with delay hint
- [ ] FatalError used for non-recoverable failures
- [ ] Each step is independently testable
- [ ] Test verifies retry behavior on transient failure
