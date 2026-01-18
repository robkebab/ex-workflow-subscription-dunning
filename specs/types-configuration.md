# Types & Configuration

Define the core TypeScript types and configuration constants for the subscription dunning workflow.

## Job to Be Done

Provide type-safe interfaces and sensible defaults so other components can be implemented without ambiguity.

## Required Types

### DunningWorkflowInput
- `provider`: billing provider identifier (e.g., `'stripe'`)
- `invoiceId`: unique invoice identifier
- `customerId`: customer identifier
- `subscriptionId`: subscription identifier
- `config?`: optional DunningConfig overrides

### DunningConfig
- `retrySchedule?`: array of delay strings (e.g., `["1d", "3d", "7d"]`)
- `maxAttempts?`: maximum retry attempts (default: 3)
- `gracePeriod?`: total grace period before final action
- `finalAction?`: action when exhausted (`'pause'` | `'cancel'` | `'mark_unpaid'`)
- `restrictAccessAfterAttempt?`: attempt number after which to restrict access

### InvoiceState
- `id`: invoice identifier
- `status`: `'open'` | `'paid'` | `'void'` | `'uncollectible'`
- `amountDue`: amount in smallest currency unit
- `currency`: ISO currency code
- `nextPaymentAttempt?`: optional next retry timestamp
- `customerId`: customer identifier
- `subscriptionId`: subscription identifier

### DunningResult
- `invoiceId`: the invoice that was processed
- `outcome`: `'recovered'` | `'exhausted'`
- `finalAction?`: action taken if exhausted
- `attemptsUsed`: number of attempts before resolution

## Required Constants

### Default Configuration
- Default retry schedule: `["1d", "3d", "7d"]`
- Default max attempts: `3`
- Default final action: `'pause'`
- Default restrict access after attempt: `2`

### Email Escalation Levels
Define escalation level identifiers (not content):
- Level 0: friendly reminder
- Level 1: urgent notice
- Level 2: final warning

## Acceptance Criteria

- [ ] All types are exported and importable
- [ ] Default config values are exported as constants
- [ ] Types compile without errors
- [ ] A test file imports all types and constants successfully
