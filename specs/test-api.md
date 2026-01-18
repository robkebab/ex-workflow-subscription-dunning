# Test API

Implement API endpoints for manual testing and debugging of the dunning workflow.

## Job to Be Done

Enable developers to manually trigger workflows, simulate customer actions, and inspect internal state during development.

## Required Endpoints

### POST /api/dunning/start
- Manually trigger dunning workflow for testing
- Accept invoice, customer, and subscription IDs in request body
- Optional config overrides in request body
- Return workflow run ID or confirmation

### GET /api/dunning/[invoiceId]
- Get current dunning status for an invoice
- Return attempt count, current state, timestamps
- Return 404 if no dunning in progress for invoice

### POST /api/test/pay-invoice
- Simulate customer paying an invoice
- Accept invoiceId in request body
- Update mock store to mark invoice as paid
- Used to test recovery path mid-dunning

### GET /api/test/state
- Dump current mock store state
- Show all invoices, email logs, subscription states
- For debugging and test verification

## Acceptance Criteria

- [ ] /api/dunning/start triggers workflow and returns confirmation
- [ ] /api/dunning/[invoiceId] returns current dunning state
- [ ] /api/test/pay-invoice marks invoice as paid in mock store
- [ ] /api/test/state returns full mock store state
- [ ] All endpoints return appropriate HTTP status codes
- [ ] All endpoints handle errors gracefully
- [ ] Test demonstrates triggering workflow via API
- [ ] Test demonstrates simulating payment recovery
