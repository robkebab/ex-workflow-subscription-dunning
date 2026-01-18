/**
 * Integration tests for the dunning workflow system.
 *
 * These tests verify the end-to-end behavior of the dunning system:
 * - Triggering workflows via /api/dunning/start
 * - Simulating payment recovery via /api/test/pay-invoice
 * - Full flow from webhook to workflow completion
 *
 * Unlike unit tests that mock dependencies, integration tests verify that
 * all components work together correctly. The workflow package is still
 * mocked to avoid actual durable sleep/webhook behavior, but the API routes,
 * store, and step functions interact as they would in production.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { dunningStore } from '../store';
import { mockStripe } from '../providers/stripe';
import { mockEmailService } from '../providers/email';
import { mockSubscriptionService } from '../providers/subscription';

// Counter for generating unique run IDs in integration tests
let mockRunIdCounter = 0;

// Mock the workflow/api module - the start() function is used to trigger workflows
// We mock it to call the workflow directly for testing without the runtime infrastructure
vi.mock('workflow/api', () => ({
  start: vi.fn().mockImplementation(async (workflowFn: Function, args: unknown[]) => {
    const runId = `run_integration_${++mockRunIdCounter}`;
    // Call the workflow directly and track completion
    const returnValuePromise = workflowFn(...args);
    return {
      runId,
      returnValue: returnValuePromise,
    };
  }),
}));

// Mock the workflow package to control timing in tests
vi.mock('workflow', () => {
  return {
    FatalError: class FatalError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'FatalError';
      }
    },
    RetryableError: class RetryableError extends Error {
      retryAfter?: number;
      constructor(message: string, options?: { retryAfter?: number }) {
        super(message);
        this.name = 'RetryableError';
        this.retryAfter = options?.retryAfter;
      }
    },
    getStepMetadata: () => ({
      stepId: `test-step-id-${Math.random().toString(36).slice(2, 11)}`,
      attempt: 1,
    }),
    createWebhook: vi.fn((options?: { token?: string }) => {
      const token = options?.token || `random-${Math.random()}`;
      return {
        token,
        url: `https://workflow.test/webhook/${token}`,
        then: vi.fn(() => new Promise(() => {})), // Never resolves by default
        [Symbol.asyncIterator]: vi.fn(),
      };
    }),
    sleep: vi.fn(() => Promise.resolve()),
  };
});

// Import API routes after mocking
import { POST as startDunning } from '../../../app/api/dunning/start/route';
import { GET as getDunningStatus } from '../../../app/api/dunning/[invoiceId]/route';
import { POST as payInvoice } from '../../../app/api/test/pay-invoice/route';
import { GET as getState } from '../../../app/api/test/state/route';
import { POST as stripeWebhook } from '../../../app/api/webhooks/stripe/route';
import { sleep } from 'workflow';

/**
 * Helper to create a mock NextRequest with JSON body.
 */
function createPostRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Helper to create a mock GET NextRequest.
 */
function createGetRequest(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

describe('Integration Tests', () => {
  beforeEach(() => {
    // Reset all state between tests
    dunningStore.reset();
    mockStripe.resetConfig();
    mockEmailService.resetConfig();
    mockSubscriptionService.resetConfig();

    // Disable random failures for deterministic tests
    mockStripe.configure({
      simulateLatency: false,
      rateLimitProbability: 0,
      transientErrorProbability: 0,
    });
    mockEmailService.configure({
      simulateLatency: false,
      transientFailureProbability: 0,
    });
    mockSubscriptionService.configure({ simulateLatency: false });

    vi.clearAllMocks();
    // Reset mock run ID counter for consistent test isolation
    mockRunIdCounter = 0;
  });

  describe('triggering workflow via /api/dunning/start', () => {
    it('successfully triggers a dunning workflow and creates store records', async () => {
      const request = createPostRequest('http://localhost:3000/api/dunning/start', {
        invoiceId: 'inv_integration_001',
        customerId: 'cus_integration_001',
        subscriptionId: 'sub_integration_001',
      });

      const response = await startDunning(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.runId).toBeDefined();
      expect(data.invoiceId).toBe('inv_integration_001');

      // Verify workflow run was created in store
      const workflowRun = dunningStore.getWorkflowRun(data.runId);
      expect(workflowRun).toBeDefined();
      expect(workflowRun?.invoiceId).toBe('inv_integration_001');
      expect(workflowRun?.customerId).toBe('cus_integration_001');
    });

    it('workflow processes to completion and updates store state', async () => {
      // Create invoice as paid so workflow recovers immediately
      dunningStore.createInvoice('inv_quick_recovery', 'cus_test', 'sub_test', {
        status: 'paid',
      });

      const request = createPostRequest('http://localhost:3000/api/dunning/start', {
        invoiceId: 'inv_quick_recovery',
        customerId: 'cus_test',
        subscriptionId: 'sub_test',
      });

      const response = await startDunning(request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Wait a small amount for async workflow to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check workflow run was updated
      const workflowRun = dunningStore.getWorkflowRun(data.runId);
      expect(workflowRun?.state).toBe('completed');
      expect(workflowRun?.outcome).toBe('recovered');
    });

    it('workflow with custom config uses provided settings', async () => {
      // Create invoice as open - will exhaust after 1 attempt
      dunningStore.createInvoice('inv_custom_config', 'cus_custom', 'sub_custom');

      const request = createPostRequest('http://localhost:3000/api/dunning/start', {
        invoiceId: 'inv_custom_config',
        customerId: 'cus_custom',
        subscriptionId: 'sub_custom',
        config: {
          maxAttempts: 1,
          finalAction: 'cancel',
        },
      });

      const response = await startDunning(request);
      const data = await response.json();

      expect(response.status).toBe(200);

      // Wait for async workflow
      await new Promise((resolve) => setTimeout(resolve, 50));

      const workflowRun = dunningStore.getWorkflowRun(data.runId);
      expect(workflowRun?.state).toBe('completed');
      expect(workflowRun?.outcome).toBe('exhausted');
      expect(workflowRun?.finalAction).toBe('cancel');

      // Verify subscription was canceled
      expect(dunningStore.isSubscriptionCanceled('sub_custom')).toBe(true);
    });

    it('rejects duplicate workflow for same invoice', async () => {
      const invoiceId = 'inv_duplicate_check';

      // Pre-create a running workflow record to simulate in-progress workflow
      // This tests the conflict detection without race conditions from async workflow completion
      const existingRunId = 'run_pre_existing';
      dunningStore.setWorkflowRun({
        runId: existingRunId,
        invoiceId,
        customerId: 'cus_dup',
        subscriptionId: 'sub_dup',
        currentAttempt: 1,
        state: 'running',
        startedAt: Date.now(),
      });

      // Second request should fail due to existing running workflow
      const request = createPostRequest('http://localhost:3000/api/dunning/start', {
        invoiceId,
        customerId: 'cus_dup',
        subscriptionId: 'sub_dup',
      });

      const response = await startDunning(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toBe('Workflow already running for this invoice');
      expect(data.runId).toBe(existingRunId);
    });
  });

  describe('simulating payment recovery via /api/test/pay-invoice', () => {
    it('marks invoice as paid in store', async () => {
      // Create invoice first
      dunningStore.createInvoice('inv_pay_test', 'cus_pay', 'sub_pay');

      const request = createPostRequest('http://localhost:3000/api/test/pay-invoice', {
        invoiceId: 'inv_pay_test',
      });

      const response = await payInvoice(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.newStatus).toBe('paid');

      // Verify store was updated
      const invoice = dunningStore.getInvoice('inv_pay_test');
      expect(invoice?.status).toBe('paid');
    });

    it('workflow detects payment and recovers', async () => {
      // Create open invoice
      dunningStore.createInvoice('inv_mid_recovery', 'cus_mid', 'sub_mid');

      // Set up sleep to allow payment between attempts
      let sleepCallCount = 0;
      vi.mocked(sleep).mockImplementation(async () => {
        sleepCallCount++;
        if (sleepCallCount === 1) {
          // Simulate payment during first wait
          dunningStore.markInvoicePaid('inv_mid_recovery');
        }
      });

      // Start workflow
      const startRequest = createPostRequest('http://localhost:3000/api/dunning/start', {
        invoiceId: 'inv_mid_recovery',
        customerId: 'cus_mid',
        subscriptionId: 'sub_mid',
        config: { maxAttempts: 3 },
      });

      const startResponse = await startDunning(startRequest);
      const startData = await startResponse.json();

      // Wait for workflow to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const workflowRun = dunningStore.getWorkflowRun(startData.runId);
      expect(workflowRun?.state).toBe('completed');
      expect(workflowRun?.outcome).toBe('recovered');
    });
  });

  describe('full flow: webhook → workflow → recovery', () => {
    it('handles Stripe webhook and triggers recovery workflow', async () => {
      // Create invoice in store
      dunningStore.createInvoice('inv_webhook_001', 'cus_webhook', 'sub_webhook', {
        status: 'paid', // Will recover immediately
      });

      // Simulate Stripe webhook
      const webhookRequest = createPostRequest('http://localhost:3000/api/webhooks/stripe', {
        id: 'evt_webhook_integration_001',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'inv_webhook_001',
            customer: 'cus_webhook',
            subscription: 'sub_webhook',
          },
        },
      });

      const webhookResponse = await stripeWebhook(webhookRequest);
      const webhookData = await webhookResponse.json();

      expect(webhookResponse.status).toBe(200);
      expect(webhookData.received).toBe(true);

      // Wait for async workflow
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify workflow completed with recovery
      const workflowRun = dunningStore.getWorkflowRunByInvoice('inv_webhook_001');
      expect(workflowRun).toBeDefined();
      expect(workflowRun?.state).toBe('completed');
      expect(workflowRun?.outcome).toBe('recovered');
    });

    it('webhook idempotency prevents duplicate workflows', async () => {
      dunningStore.createInvoice('inv_idem_001', 'cus_idem', 'sub_idem', {
        status: 'paid',
      });

      const eventId = 'evt_idempotent_001';

      // First webhook
      const request1 = createPostRequest('http://localhost:3000/api/webhooks/stripe', {
        id: eventId,
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'inv_idem_001',
            customer: 'cus_idem',
            subscription: 'sub_idem',
          },
        },
      });

      const response1 = await stripeWebhook(request1);
      expect(response1.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second webhook with same event ID
      const request2 = createPostRequest('http://localhost:3000/api/webhooks/stripe', {
        id: eventId,
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'inv_idem_001',
            customer: 'cus_idem',
            subscription: 'sub_idem',
          },
        },
      });

      const response2 = await stripeWebhook(request2);
      const data2 = await response2.json();

      expect(response2.status).toBe(200);
      expect(data2.reason).toBe('duplicate');
      expect(data2.processed).toBe(false);
    });
  });

  describe('full flow: webhook → workflow → exhaustion', () => {
    it('handles exhausted workflow with final action', async () => {
      // Create open invoice that won't be paid
      dunningStore.createInvoice('inv_exhaust_001', 'cus_exhaust', 'sub_exhaust');

      const startRequest = createPostRequest('http://localhost:3000/api/dunning/start', {
        invoiceId: 'inv_exhaust_001',
        customerId: 'cus_exhaust',
        subscriptionId: 'sub_exhaust',
        config: {
          maxAttempts: 2,
          finalAction: 'pause',
          restrictAccessAfterAttempt: 2,
        },
      });

      const startResponse = await startDunning(startRequest);
      const startData = await startResponse.json();

      // Wait for workflow completion
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify exhaustion
      const workflowRun = dunningStore.getWorkflowRun(startData.runId);
      expect(workflowRun?.state).toBe('completed');
      expect(workflowRun?.outcome).toBe('exhausted');
      expect(workflowRun?.finalAction).toBe('pause');

      // Verify side effects
      expect(dunningStore.isSubscriptionPaused('sub_exhaust')).toBe(true);
      expect(dunningStore.isCustomerRestricted('cus_exhaust')).toBe(true);

      // Verify emails were sent
      const emails = dunningStore.getEmailLogs('inv_exhaust_001');
      expect(emails.length).toBe(2); // 2 attempts = 2 emails
    });
  });

  describe('state inspection via /api/test/state', () => {
    it('returns full store state for debugging', async () => {
      // Set up some state
      dunningStore.createInvoice('inv_state_001', 'cus_state', 'sub_state');
      dunningStore.setWorkflowRun({
        runId: 'run_state_001',
        invoiceId: 'inv_state_001',
        customerId: 'cus_state',
        subscriptionId: 'sub_state',
        currentAttempt: 1,
        state: 'running',
        startedAt: Date.now(),
      });

      const request = createGetRequest('http://localhost:3000/api/test/state');
      const response = await getState();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.invoices).toBeDefined();
      expect(data.workflowRuns).toBeDefined();
      expect(data._summary).toBeDefined();
      expect(data._summary.invoiceCount).toBe(1);
      expect(data._summary.workflowRunCount).toBe(1);
    });
  });

  describe('status lookup via /api/dunning/[invoiceId]', () => {
    it('returns workflow status for active invoice', async () => {
      // Create workflow run
      dunningStore.createInvoice('inv_status_001', 'cus_status', 'sub_status');
      dunningStore.setWorkflowRun({
        runId: 'run_status_001',
        invoiceId: 'inv_status_001',
        customerId: 'cus_status',
        subscriptionId: 'sub_status',
        currentAttempt: 2,
        state: 'running',
        startedAt: Date.now() - 10000,
      });

      // Create mock request with params
      const request = new NextRequest(
        'http://localhost:3000/api/dunning/inv_status_001',
        { method: 'GET' }
      );

      const response = await getDunningStatus(request, {
        params: Promise.resolve({ invoiceId: 'inv_status_001' }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.invoiceId).toBe('inv_status_001');
      expect(data.state).toBe('running');
      expect(data.currentAttempt).toBe(2);
    });

    it('returns 404 for unknown invoice', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/dunning/inv_unknown',
        { method: 'GET' }
      );

      const response = await getDunningStatus(request, {
        params: Promise.resolve({ invoiceId: 'inv_unknown' }),
      });

      expect(response.status).toBe(404);
    });
  });
});
