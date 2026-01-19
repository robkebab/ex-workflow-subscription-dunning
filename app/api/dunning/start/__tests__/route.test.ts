/**
 * Tests for the dunning start endpoint.
 *
 * This endpoint allows developers to manually trigger dunning workflows for testing.
 * Tests verify request validation, workflow creation, and conflict handling.
 *
 * The endpoint uses `start()` from workflow/api to trigger workflows through the
 * runtime, which provides durable execution, observability, and proper Run management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../route';
import { dunningStore } from '@/lib/dunning/store';

// Counter for generating unique run IDs in tests
let mockRunIdCounter = 0;

// Mock the workflow/api module to avoid actually running workflows during tests
// The start() function returns a Run object with runId and returnValue
vi.mock('workflow/api', () => ({
  start: vi.fn().mockImplementation(() => {
    const runId = `run_mock_${++mockRunIdCounter}`;
    return Promise.resolve({
      runId,
      returnValue: Promise.resolve({
        invoiceId: 'inv_test123',
        outcome: 'recovered',
        attemptsUsed: 1,
      }),
    });
  }),
}));

// Mock the workflow module (still needed for import)
vi.mock('@/lib/dunning/workflow', () => ({
  dunningWorkflow: vi.fn(),
}));

/**
 * Helper to create a mock NextRequest with JSON body.
 */
function createMockRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/dunning/start', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Helper to create a valid start dunning request body.
 */
function createValidRequest(
  overrides?: Partial<{
    invoiceId: string;
    customerId: string;
    subscriptionId: string;
    config: Record<string, unknown>;
  }>
): Record<string, unknown> {
  return {
    invoiceId: overrides?.invoiceId ?? 'inv_test123',
    customerId: overrides?.customerId ?? 'cus_test456',
    subscriptionId: overrides?.subscriptionId ?? 'sub_test789',
    ...(overrides?.config && { config: overrides.config }),
  };
}

describe('POST /api/dunning/start', () => {
  beforeEach(() => {
    // Reset store state before each test
    dunningStore.reset();
    vi.clearAllMocks();
    // Reset mock run ID counter for consistent test isolation
    mockRunIdCounter = 0;
  });

  describe('successful workflow trigger', () => {
    it('starts a dunning workflow with valid input', async () => {
      const body = createValidRequest({
        invoiceId: 'inv_start_001',
        customerId: 'cus_start_001',
        subscriptionId: 'sub_start_001',
      });

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.runId).toBeDefined();
      expect(data.invoiceId).toBe('inv_start_001');
      expect(data.customerId).toBe('cus_start_001');
      expect(data.subscriptionId).toBe('sub_start_001');
    });

    it('creates an invoice run mapping in the store', async () => {
      const body = createValidRequest({
        invoiceId: 'inv_start_002',
        customerId: 'cus_start_002',
        subscriptionId: 'sub_start_002',
      });

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      // Check that invoice -> runId mapping was created (not full workflow state)
      const mapping = dunningStore.getInvoiceRunMapping('inv_start_002');
      expect(mapping).toBeDefined();
      expect(mapping?.runId).toBe(data.runId);
      expect(mapping?.invoiceId).toBe('inv_start_002');
      expect(mapping?.customerId).toBe('cus_start_002');
      expect(mapping?.subscriptionId).toBe('sub_start_002');
    });

    it('accepts optional config overrides', async () => {
      const body = createValidRequest({
        invoiceId: 'inv_config_001',
        config: {
          maxAttempts: 5,
          retrySchedule: ['2d', '4d', '6d'],
          finalAction: 'cancel',
          restrictAccessAfterAttempt: 3,
        },
      });

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.runId).toBeDefined();
    });

    it('accepts partial config overrides', async () => {
      const body = createValidRequest({
        invoiceId: 'inv_partial_config',
        config: {
          maxAttempts: 2,
        },
      });

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('conflict handling', () => {
    it('returns 409 when workflow mapping exists for invoice', async () => {
      const invoiceId = 'inv_conflict_001';

      // First request starts the workflow
      const body1 = createValidRequest({ invoiceId });
      const request1 = createMockRequest(body1);
      const response1 = await POST(request1);
      const data1 = await response1.json();

      expect(response1.status).toBe(200);
      expect(data1.success).toBe(true);

      // Second request should fail with conflict (mapping exists)
      const body2 = createValidRequest({ invoiceId });
      const request2 = createMockRequest(body2);
      const response2 = await POST(request2);
      const data2 = await response2.json();

      expect(response2.status).toBe(409);
      expect(data2.error).toBe('Workflow already running for this invoice');
      expect(data2.runId).toBe(data1.runId);
    });

    it('returns 409 even for different invoiceId-related params when mapping exists', async () => {
      const invoiceId = 'inv_conflict_params_001';

      // First request with specific params
      const body1 = createValidRequest({
        invoiceId,
        customerId: 'cus_original',
        subscriptionId: 'sub_original',
      });
      const request1 = createMockRequest(body1);
      const response1 = await POST(request1);
      const data1 = await response1.json();

      expect(response1.status).toBe(200);

      // Second request with different customer/subscription (same invoice)
      // Should still fail because the invoiceId mapping exists
      const body2 = createValidRequest({
        invoiceId,
        customerId: 'cus_different',
        subscriptionId: 'sub_different',
      });
      const request2 = createMockRequest(body2);
      const response2 = await POST(request2);
      const data2 = await response2.json();

      expect(response2.status).toBe(409);
      expect(data2.runId).toBe(data1.runId);
    });
  });

  describe('malformed request handling', () => {
    it('returns 400 for invalid JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/dunning/start', {
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
      const body = {
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
      };

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Required: invoiceId');
    });

    it('returns 400 for missing customerId', async () => {
      const body = {
        invoiceId: 'inv_123',
        subscriptionId: 'sub_123',
      };

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Required:');
    });

    it('returns 400 for missing subscriptionId', async () => {
      const body = {
        invoiceId: 'inv_123',
        customerId: 'cus_123',
      };

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Required:');
    });

    it('returns 400 for empty invoiceId', async () => {
      const body = {
        invoiceId: '',
        customerId: 'cus_123',
        subscriptionId: 'sub_123',
      };

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Required:');
    });

    it('returns 400 for empty body', async () => {
      const request = createMockRequest({});
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

    it('returns 400 for invalid config.finalAction', async () => {
      const body = createValidRequest({
        config: {
          finalAction: 'invalid_action',
        },
      });

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid config.maxAttempts type', async () => {
      const body = createValidRequest({
        config: {
          maxAttempts: 'not a number',
        },
      });

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid config.retrySchedule type', async () => {
      const body = createValidRequest({
        config: {
          retrySchedule: 'not an array',
        },
      });

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid config.retrySchedule items', async () => {
      const body = createValidRequest({
        config: {
          retrySchedule: [1, 2, 3], // Should be strings
        },
      });

      const request = createMockRequest(body);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
    });
  });
});
