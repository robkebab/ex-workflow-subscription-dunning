# Mock Providers

Implement realistic mock providers for Stripe billing, email delivery, and subscription management.

## Job to Be Done

Enable local development and testing without external API dependencies while simulating realistic behavior including delays, rate limits, and failures.

## Required Providers

### Mock Stripe Provider
- `getInvoice(invoiceId)`: fetch invoice state
- `checkInvoiceStatus(invoiceId)`: return current payment status
- Support `next_payment_attempt` hint for testing
- Simulate occasional 429 rate limit responses
- Simulate configurable latency (50-200ms)

### Mock Email Service
- `sendEmail(options)`: send dunning notification
- Accept idempotency key to prevent duplicate sends
- Log all sent emails with timestamp and content summary
- Simulate occasional transient failures (retry-able)

### Mock Subscription Service
- `pauseSubscription(subscriptionId)`: pause a subscription
- `restrictAccess(customerId)`: mark customer as access-restricted
- Both operations must be idempotent

### In-Memory Dunning Store
- Track invoice states across workflow runs
- Allow external manipulation (e.g., "mark invoice paid")
- Support concurrent access patterns
- Reset capability for test isolation

## Behavior Requirements

- All operations log for observability
- Track calls by idempotency key to ensure idempotency
- External test manipulation supported (simulate customer paying)
- Configurable failure injection for testing retry behavior

## Acceptance Criteria

- [ ] Mock Stripe returns invoice state and simulates 429s
- [ ] Mock email logs sends and respects idempotency keys
- [ ] Mock subscription service operations are idempotent
- [ ] Store allows external state manipulation
- [ ] All mocks log operations for debugging
- [ ] Test demonstrates retry behavior on transient failure
