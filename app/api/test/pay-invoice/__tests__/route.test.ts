/**
 * Tests for the pay-invoice test endpoint.
 *
 * This endpoint allows developers to simulate invoice payment during dunning tests.
 * It marks an invoice as paid in the mock store, which the dunning workflow will
 * detect on its next status check, triggering the recovery path.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { dunningStore } from '@/lib/dunning/store';

/**
 * Helper to create a mock NextRequest with JSON body.
 */
function createMockRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/test/pay-invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/test/pay-invoice', () => {
  beforeEach(() => {
    dunningStore.reset();
  });

  describe('successful payment simulation', () => {
    it('marks an open invoice as paid', async () => {
      // Create an open invoice in the store
      dunningStore.createInvoice('inv_pay_001', 'cus_001', 'sub_001', {
        status: 'open',
      });

      const request = createMockRequest({ invoiceId: 'inv_pay_001' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.invoiceId).toBe('inv_pay_001');
      expect(data.previousStatus).toBe('open');
      expect(data.newStatus).toBe('paid');
      expect(data.message).toBe('Invoice has been marked as paid');

      // Verify store was updated
      const invoice = dunningStore.getInvoice('inv_pay_001');
      expect(invoice?.status).toBe('paid');
    });

    it('handles already paid invoice gracefully', async () => {
      // Create a paid invoice
      dunningStore.createInvoice('inv_pay_002', 'cus_002', 'sub_002', {
        status: 'paid',
      });

      const request = createMockRequest({ invoiceId: 'inv_pay_002' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.invoiceId).toBe('inv_pay_002');
      expect(data.previousStatus).toBe('paid');
      expect(data.message).toBe('Invoice was already paid');
      expect(data.newStatus).toBeUndefined();
    });

    it('marks a past_due invoice as paid', async () => {
      dunningStore.createInvoice('inv_pay_003', 'cus_003', 'sub_003', {
        status: 'past_due',
      });

      const request = createMockRequest({ invoiceId: 'inv_pay_003' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.previousStatus).toBe('past_due');
      expect(data.newStatus).toBe('paid');
    });

    it('marks an uncollectible invoice as paid', async () => {
      dunningStore.createInvoice('inv_pay_004', 'cus_004', 'sub_004', {
        status: 'uncollectible',
      });

      const request = createMockRequest({ invoiceId: 'inv_pay_004' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.previousStatus).toBe('uncollectible');
      expect(data.newStatus).toBe('paid');
    });
  });

  describe('invoice not found handling', () => {
    it('returns 404 for non-existent invoice', async () => {
      const request = createMockRequest({ invoiceId: 'inv_nonexistent' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Invoice not found');
      expect(data.invoiceId).toBe('inv_nonexistent');
    });

    it('returns 404 after store reset', async () => {
      // Create invoice, then reset store
      dunningStore.createInvoice('inv_pay_reset', 'cus_reset', 'sub_reset');
      dunningStore.reset();

      const request = createMockRequest({ invoiceId: 'inv_pay_reset' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Invoice not found');
    });
  });

  describe('malformed request handling', () => {
    it('returns 400 for invalid JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/test/pay-invoice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'not valid json',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid JSON body');
    });

    it('returns 400 for missing invoiceId', async () => {
      const request = createMockRequest({});
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Required: invoiceId');
    });

    it('returns 400 for empty invoiceId', async () => {
      const request = createMockRequest({ invoiceId: '' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Required: invoiceId');
    });

    it('returns 400 for null invoiceId', async () => {
      const request = createMockRequest({ invoiceId: null });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
    });

    it('returns 400 for numeric invoiceId', async () => {
      const request = createMockRequest({ invoiceId: 12345 });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
    });

    it('returns 400 for null body', async () => {
      const request = createMockRequest(null);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
    });
  });

  describe('recovery path demonstration', () => {
    it('demonstrates recovery path: invoice can be paid mid-dunning', async () => {
      // This test demonstrates the intended use case: simulating payment
      // during an active dunning workflow to test the recovery path.

      // 1. Create an open invoice (as if Stripe reported payment failure)
      const invoiceId = 'inv_recovery_demo';
      const customerId = 'cus_recovery_demo';
      const subscriptionId = 'sub_recovery_demo';

      dunningStore.createInvoice(invoiceId, customerId, subscriptionId, {
        status: 'open',
        amountDue: 4999, // $49.99
        currency: 'usd',
      });

      // 2. Simulate a dunning workflow starting (it would check status and find 'open')
      dunningStore.setWorkflowRun({
        runId: 'run_recovery_demo',
        invoiceId,
        customerId,
        subscriptionId,
        currentAttempt: 1,
        state: 'running',
        startedAt: Date.now(),
      });

      // 3. Customer pays via the portal (simulated by this endpoint)
      const request = createMockRequest({ invoiceId });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.previousStatus).toBe('open');
      expect(data.newStatus).toBe('paid');

      // 4. The workflow would detect this on next checkInvoiceStatus call
      const invoice = dunningStore.getInvoice(invoiceId);
      expect(invoice?.status).toBe('paid');

      // 5. Workflow run would still be 'running' until it checks status
      const run = dunningStore.getWorkflowRun('run_recovery_demo');
      expect(run?.state).toBe('running');
    });
  });
});
