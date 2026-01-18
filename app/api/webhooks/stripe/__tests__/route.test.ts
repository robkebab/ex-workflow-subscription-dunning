/**
 * Tests for Stripe webhook endpoint.
 *
 * These tests verify that the webhook endpoint correctly handles Stripe events,
 * validates payloads, maintains idempotency, and starts dunning workflows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { dunningStore } from '@/lib/dunning/store';

// Mock the workflow module to avoid actually running workflows during tests
vi.mock('@/lib/dunning/workflow', () => ({
  dunningWorkflow: vi.fn().mockResolvedValue({
    invoiceId: 'inv_test123',
    outcome: 'recovered',
    attemptsUsed: 1,
  }),
}));

/**
 * Helper to create a mock NextRequest with JSON body.
 */
function createMockRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Helper to create a valid Stripe invoice.payment_failed event.
 */
function createPaymentFailedEvent(
  overrides?: Partial<{
    id: string;
    invoiceId: string;
    customerId: string;
    subscriptionId: string | null;
  }>
): Record<string, unknown> {
  // Use explicit check for subscriptionId since null is a valid value
  const hasSubscriptionOverride = overrides && 'subscriptionId' in overrides;
  return {
    id: overrides?.id ?? `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: overrides?.invoiceId ?? 'inv_test123',
        customer: overrides?.customerId ?? 'cus_test456',
        subscription: hasSubscriptionOverride ? overrides.subscriptionId : 'sub_test789',
      },
    },
  };
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    // Reset store state before each test
    dunningStore.reset();
    vi.clearAllMocks();
  });

  describe('successful event processing', () => {
    it('processes a valid invoice.payment_failed event', async () => {
      const event = createPaymentFailedEvent({
        id: 'evt_unique_1',
        invoiceId: 'inv_test_001',
        customerId: 'cus_test_001',
        subscriptionId: 'sub_test_001',
      });

      const request = createMockRequest(event);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.received).toBe(true);
      expect(data.processed).toBe(true);
      expect(data.runId).toBeDefined();
      expect(data.invoiceId).toBe('inv_test_001');
    });

    it('creates a workflow run record in the store', async () => {
      const event = createPaymentFailedEvent({
        id: 'evt_unique_2',
        invoiceId: 'inv_test_002',
        customerId: 'cus_test_002',
        subscriptionId: 'sub_test_002',
      });

      const request = createMockRequest(event);
      const response = await POST(request);
      const data = await response.json();

      const workflowRun = dunningStore.getWorkflowRun(data.runId);
      expect(workflowRun).toBeDefined();
      expect(workflowRun?.invoiceId).toBe('inv_test_002');
      expect(workflowRun?.customerId).toBe('cus_test_002');
      expect(workflowRun?.subscriptionId).toBe('sub_test_002');
      // Note: Since mock workflow resolves immediately, state may be 'completed'
      expect(['running', 'completed']).toContain(workflowRun?.state);
    });

    it('handles events without a subscription ID', async () => {
      const event = createPaymentFailedEvent({
        id: 'evt_no_sub_1',
        invoiceId: 'inv_one_time_001',
        customerId: 'cus_one_time_001',
        subscriptionId: null,
      });

      const request = createMockRequest(event);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.processed).toBe(true);

      const workflowRun = dunningStore.getWorkflowRun(data.runId);
      expect(workflowRun).toBeDefined();
      expect(workflowRun?.subscriptionId).toBe('');
    });

    it('marks event as processed in the store', async () => {
      const eventId = 'evt_track_processed_1';
      const event = createPaymentFailedEvent({ id: eventId });

      const request = createMockRequest(event);
      await POST(request);

      expect(dunningStore.hasProcessedEvent(eventId)).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('does not start duplicate workflows for same event ID', async () => {
      const eventId = 'evt_duplicate_test';
      const event = createPaymentFailedEvent({ id: eventId });

      // Process the event twice
      const request1 = createMockRequest(event);
      const response1 = await POST(request1);
      const data1 = await response1.json();

      const request2 = createMockRequest(event);
      const response2 = await POST(request2);
      const data2 = await response2.json();

      // First request should process
      expect(data1.processed).toBe(true);
      expect(data1.runId).toBeDefined();

      // Second request should be identified as duplicate
      expect(response2.status).toBe(200);
      expect(data2.processed).toBe(false);
      expect(data2.reason).toBe('duplicate');
      expect(data2.runId).toBeUndefined();
    });

    it('processes different event IDs for same invoice independently', async () => {
      const invoiceId = 'inv_same_invoice';
      const event1 = createPaymentFailedEvent({
        id: 'evt_first_attempt',
        invoiceId,
      });
      const event2 = createPaymentFailedEvent({
        id: 'evt_second_attempt',
        invoiceId,
      });

      const request1 = createMockRequest(event1);
      const response1 = await POST(request1);
      const data1 = await response1.json();

      const request2 = createMockRequest(event2);
      const response2 = await POST(request2);
      const data2 = await response2.json();

      // Both events should be processed (they have different event IDs)
      expect(data1.processed).toBe(true);
      expect(data2.processed).toBe(true);
      expect(data1.runId).not.toBe(data2.runId);
    });
  });

  describe('ignores other event types', () => {
    it('acknowledges but does not process non-payment_failed events', async () => {
      const event = {
        id: 'evt_other_type',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_new_123',
            customer: 'cus_other_123',
          },
        },
      };

      const request = createMockRequest(event);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.received).toBe(true);
      expect(data.processed).toBe(false);
      expect(data.runId).toBeUndefined();
    });

    it('does not mark non-payment_failed events as processed', async () => {
      const eventId = 'evt_other_not_tracked';
      const event = {
        id: eventId,
        type: 'invoice.paid',
        data: {
          object: {
            id: 'inv_paid_123',
            customer: 'cus_paid_123',
          },
        },
      };

      const request = createMockRequest(event);
      await POST(request);

      // Event should NOT be tracked as processed (only track invoice.payment_failed)
      expect(dunningStore.hasProcessedEvent(eventId)).toBe(false);
    });
  });

  describe('malformed payload handling', () => {
    it('returns 400 for invalid JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/webhooks/stripe', {
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

    it('returns 400 for missing event ID', async () => {
      const event = {
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'inv_123',
            customer: 'cus_123',
          },
        },
      };

      const request = createMockRequest(event);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Malformed webhook payload');
    });

    it('returns 400 for missing event type', async () => {
      const event = {
        id: 'evt_no_type',
        data: {
          object: {
            id: 'inv_123',
            customer: 'cus_123',
          },
        },
      };

      const request = createMockRequest(event);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Malformed webhook payload');
    });

    it('returns 400 for missing invoice ID in data.object', async () => {
      const event = {
        id: 'evt_no_invoice',
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_123',
          },
        },
      };

      const request = createMockRequest(event);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Malformed webhook payload');
    });

    it('returns 400 for missing customer ID in data.object', async () => {
      const event = {
        id: 'evt_no_customer',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'inv_123',
          },
        },
      };

      const request = createMockRequest(event);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Malformed webhook payload');
    });

    it('returns 400 for empty body', async () => {
      const request = createMockRequest({});
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Malformed webhook payload');
    });

    it('returns 400 for null body', async () => {
      const request = createMockRequest(null);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Malformed webhook payload');
    });

    it('returns 400 for missing data object', async () => {
      const event = {
        id: 'evt_no_data',
        type: 'invoice.payment_failed',
      };

      const request = createMockRequest(event);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Malformed webhook payload');
    });
  });
});
