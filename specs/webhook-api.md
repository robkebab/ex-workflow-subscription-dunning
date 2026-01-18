# Webhook API

Implement API endpoints for handling external webhook events that trigger or interact with the dunning workflow.

## Job to Be Done

Receive Stripe webhook events for failed payments and route them to start the dunning workflow.

## Required Endpoints

### POST /api/webhooks/stripe
- Handle `invoice.payment_failed` event
- Extract invoice, customer, and subscription IDs from payload
- Start dunning workflow with extracted data
- Return 200 to acknowledge receipt
- Idempotent: same event ID should not start duplicate workflows

## Webhook Handling Requirements

- Skip webhook signature verification (note in comments for production)
- Log received events for observability
- Handle malformed payloads gracefully (return 400)
- Return 200 quickly; workflow starts asynchronously

## Stripe Event Structure

Expected fields from `invoice.payment_failed`:
- `data.object.id`: invoice ID
- `data.object.customer`: customer ID
- `data.object.subscription`: subscription ID

## Acceptance Criteria

- [ ] Endpoint receives POST at /api/webhooks/stripe
- [ ] Correctly extracts IDs from Stripe event payload
- [ ] Starts dunning workflow with correct input
- [ ] Returns 200 on successful processing
- [ ] Returns 400 on malformed payload
- [ ] Idempotent: duplicate events do not start duplicate workflows
- [ ] Comment notes webhook verification skipped for demo
- [ ] Test verifies workflow started from webhook event
