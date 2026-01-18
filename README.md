# Subscription Dunning Workflow

A production-ready subscription dunning workflow built with [Vercel Workflow DevKit](https://useworkflow.dev) and Next.js. This system automatically handles failed subscription payments by sending escalating reminder emails, restricting access, and executing final actions when payment recovery fails.

## What is Dunning?

Dunning is the process of communicating with customers to collect overdue payments. This workflow automates the entire process:

1. **Initial notification** - Friendly reminder that payment failed
2. **Escalating emails** - Increasingly urgent messages on a schedule
3. **Access restriction** - Optionally restrict service access after repeated failures
4. **Final action** - Pause, cancel, or mark subscription as unpaid after all attempts exhausted

## Architecture

```
┌────────────────────┐      ┌─────────────────────┐
│   Stripe Webhook   │─────▶│  /api/webhooks/     │
│ invoice.payment_   │      │     stripe          │
│      failed        │      └──────────┬──────────┘
└────────────────────┘                 │
                                       ▼
                              ┌─────────────────────┐
                              │  Dunning Workflow   │
                              │  (Workflow DevKit)  │
                              └──────────┬──────────┘
                                         │
           ┌─────────────────────────────┼─────────────────────────────┐
           │                             │                             │
           ▼                             ▼                             ▼
    ┌─────────────┐             ┌─────────────┐              ┌─────────────┐
    │ Send Email  │             │   Sleep     │              │  Execute    │
    │   (step)    │             │  (durable)  │              │ Final Action│
    └─────────────┘             └─────────────┘              └─────────────┘
```

The workflow uses Workflow DevKit patterns:
- **Durable sleep** - Multi-day delays without consuming resources
- **Webhooks** - Customer can "pay now" to interrupt the workflow
- **Step functions** - Atomic operations with retry semantics

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Run tests
pnpm test
```

## API Endpoints

### Production Endpoints

#### `POST /api/webhooks/stripe`

Receives Stripe webhook events for `invoice.payment_failed`. Automatically starts the dunning workflow.

```bash
curl -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_123",
    "type": "invoice.payment_failed",
    "data": {
      "object": {
        "id": "inv_abc",
        "customer": "cus_xyz",
        "subscription": "sub_123"
      }
    }
  }'
```

### Testing Endpoints

#### `POST /api/dunning/start`

Manually trigger a dunning workflow for testing.

```bash
curl -X POST http://localhost:3000/api/dunning/start \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "inv_test123",
    "customerId": "cus_test456",
    "subscriptionId": "sub_test789",
    "config": {
      "maxAttempts": 3,
      "retrySchedule": ["1d", "3d", "7d"],
      "finalAction": "pause"
    }
  }'
```

#### `GET /api/dunning/:invoiceId`

Get current dunning status for an invoice.

```bash
curl http://localhost:3000/api/dunning/inv_test123
```

#### `POST /api/test/pay-invoice`

Simulate customer paying an invoice (triggers recovery path).

```bash
curl -X POST http://localhost:3000/api/test/pay-invoice \
  -H "Content-Type: application/json" \
  -d '{"invoiceId": "inv_test123"}'
```

#### `GET /api/test/state`

Dump the current mock store state for debugging.

```bash
curl http://localhost:3000/api/test/state
```

## Configuration

The dunning workflow accepts configuration overrides:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `retrySchedule` | `string[]` | `["1d", "3d", "7d"]` | Delay between attempts (supports d/h/m/s) |
| `maxAttempts` | `number` | `3` | Maximum retry attempts |
| `finalAction` | `string` | `"pause"` | Action on exhaustion: `pause`, `cancel`, or `mark_unpaid` |
| `restrictAccessAfterAttempt` | `number` | `2` | Restrict access after this attempt number |

## Project Structure

```
lib/dunning/
├── types.ts           # TypeScript interfaces and constants
├── store.ts           # In-memory state store for testing
├── workflow.ts        # Main dunning workflow orchestration
├── providers/         # Mock service providers
│   ├── stripe.ts      # Mock Stripe API
│   ├── email.ts       # Mock email service
│   └── subscription.ts # Mock subscription service
├── steps/             # Workflow step functions
│   ├── check-invoice-status.ts
│   ├── send-dunning-email.ts
│   ├── restrict-access.ts
│   └── execute-final-action.ts
└── utils/
    └── duration.ts    # Duration string parser ("1d" → ms)

app/api/
├── webhooks/stripe/   # Stripe webhook handler
├── dunning/
│   ├── start/         # Manual workflow trigger
│   └── [invoiceId]/   # Status lookup
└── test/
    ├── pay-invoice/   # Simulate payment
    └── state/         # Debug state dump
```

## Testing

The project uses Vitest for testing with 272 tests covering:

- Type definitions and constants
- Mock providers (Stripe, email, subscription)
- Step functions (with retry/error semantics)
- Core workflow logic
- API endpoints
- Integration tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Production Considerations

This implementation uses mock providers for demonstration. For production:

1. **Stripe Integration** - Replace mock Stripe provider with real Stripe API calls
2. **Email Service** - Integrate with SendGrid, SES, or your email provider
3. **Webhook Verification** - Enable Stripe webhook signature verification
4. **Persistence** - Replace in-memory store with a database
5. **Monitoring** - Add alerting for failed workflows and exhausted dunning

## Learn More

- [Workflow DevKit Documentation](https://useworkflow.dev)
- [Next.js Documentation](https://nextjs.org/docs)
- [Stripe Billing Documentation](https://stripe.com/docs/billing)
