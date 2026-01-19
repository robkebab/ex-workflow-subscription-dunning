/**
 * Tests for the dunning status endpoint.
 *
 * This endpoint provides visibility into the current state of dunning workflows
 * by querying the workflow runtime. Tests verify status retrieval via getRun(),
 * 404 handling for missing workflows, and proper response formatting.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { dunningStore } from '@/lib/dunning/store';
import type { DunningResult } from '@/lib/dunning/types';

// Mock the workflow/api module
vi.mock('workflow/api', () => ({
  getRun: vi.fn(),
}));

import { getRun } from 'workflow/api';

const mockGetRun = vi.mocked(getRun);

/**
 * Helper to create a mock GET request for a specific invoice ID.
 */
function createMockRequest(invoiceId: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/dunning/${invoiceId}`, {
    method: 'GET',
  });
}

/**
 * Helper to create route params matching Next.js App Router convention.
 */
function createRouteParams(invoiceId: string): { params: Promise<{ invoiceId: string }> } {
  return {
    params: Promise.resolve({ invoiceId }),
  };
}

/**
 * Helper to create a mock Run object with the given status and result.
 */
function createMockRun(options: {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: DunningResult;
  createdAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}) {
  const createdAt = options.createdAt ?? new Date();
  const startedAt = options.startedAt ?? (options.status !== 'pending' ? new Date() : undefined);
  const completedAt = options.completedAt ?? (options.status === 'completed' || options.status === 'failed' ? new Date() : undefined);

  // Create a never-resolving promise for incomplete workflows to avoid unhandled rejections
  // The actual code only accesses returnValue when status is 'completed'
  const neverResolve = new Promise<DunningResult>(() => {});

  return {
    runId: 'mock_run_id',
    status: Promise.resolve(options.status),
    returnValue: options.result
      ? Promise.resolve(options.result)
      : neverResolve,
    createdAt: Promise.resolve(createdAt),
    startedAt: Promise.resolve(startedAt),
    completedAt: Promise.resolve(completedAt),
    cancel: vi.fn(),
    workflowName: Promise.resolve('dunningWorkflow'),
    readable: new ReadableStream(),
    getReadable: vi.fn(),
  };
}

describe('GET /api/dunning/[invoiceId]', () => {
  beforeEach(() => {
    // Reset store state and mocks before each test
    dunningStore.reset();
    vi.clearAllMocks();
  });

  describe('successful status retrieval', () => {
    it('returns workflow status for existing invoice', async () => {
      const runId = 'run_status_001';
      const invoiceId = 'inv_status_001';
      const createdAt = new Date();

      // Set up the invoice -> runId mapping
      dunningStore.setInvoiceRunMapping({
        invoiceId,
        runId,
        customerId: 'cus_status_001',
        subscriptionId: 'sub_status_001',
      });

      // Mock the Run object from workflow runtime
      mockGetRun.mockReturnValue(createMockRun({
        status: 'running',
        createdAt,
        startedAt: createdAt,
      }) as ReturnType<typeof getRun>);

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.runId).toBe(runId);
      expect(data.invoiceId).toBe(invoiceId);
      expect(data.customerId).toBe('cus_status_001');
      expect(data.subscriptionId).toBe('sub_status_001');
      expect(data.status).toBe('running');
      expect(mockGetRun).toHaveBeenCalledWith(runId);
    });

    it('returns completed workflow with result', async () => {
      const runId = 'run_completed_001';
      const invoiceId = 'inv_completed_001';
      const createdAt = new Date(Date.now() - 60000);
      const startedAt = new Date(Date.now() - 60000);
      const completedAt = new Date();

      dunningStore.setInvoiceRunMapping({
        invoiceId,
        runId,
        customerId: 'cus_completed_001',
        subscriptionId: 'sub_completed_001',
      });

      const result: DunningResult = {
        invoiceId,
        outcome: 'recovered',
        attemptsUsed: 1,
      };

      mockGetRun.mockReturnValue(createMockRun({
        status: 'completed',
        result,
        createdAt,
        startedAt,
        completedAt,
      }) as ReturnType<typeof getRun>);

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('completed');
      expect(data.result).toEqual(result);
      expect(data.result.outcome).toBe('recovered');
      expect(data.completedAt).toBeDefined();
    });

    it('returns exhausted workflow with final action in result', async () => {
      const runId = 'run_exhausted_001';
      const invoiceId = 'inv_exhausted_001';
      const createdAt = new Date(Date.now() - 120000);
      const startedAt = new Date(Date.now() - 120000);
      const completedAt = new Date();

      dunningStore.setInvoiceRunMapping({
        invoiceId,
        runId,
        customerId: 'cus_exhausted_001',
        subscriptionId: 'sub_exhausted_001',
      });

      const result: DunningResult = {
        invoiceId,
        outcome: 'exhausted',
        finalAction: 'pause',
        attemptsUsed: 3,
      };

      mockGetRun.mockReturnValue(createMockRun({
        status: 'completed',
        result,
        createdAt,
        startedAt,
        completedAt,
      }) as ReturnType<typeof getRun>);

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('completed');
      expect(data.result.outcome).toBe('exhausted');
      expect(data.result.finalAction).toBe('pause');
    });

    it('returns timestamps in ISO format', async () => {
      const runId = 'run_timestamps_001';
      const invoiceId = 'inv_timestamps_001';
      const createdAt = new Date('2024-01-15T10:30:00.000Z');
      const startedAt = new Date('2024-01-15T10:30:00.000Z');
      const completedAt = new Date('2024-01-15T10:35:00.000Z');

      dunningStore.setInvoiceRunMapping({
        invoiceId,
        runId,
        customerId: 'cus_timestamps_001',
        subscriptionId: 'sub_timestamps_001',
      });

      const result: DunningResult = {
        invoiceId,
        outcome: 'recovered',
        attemptsUsed: 2,
      };

      mockGetRun.mockReturnValue(createMockRun({
        status: 'completed',
        result,
        createdAt,
        startedAt,
        completedAt,
      }) as ReturnType<typeof getRun>);

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      // Verify ISO format by parsing
      expect(new Date(data.createdAt).toISOString()).toBe(data.createdAt);
      expect(new Date(data.startedAt).toISOString()).toBe(data.startedAt);
      expect(new Date(data.completedAt).toISOString()).toBe(data.completedAt);
    });
  });

  describe('404 handling', () => {
    it('returns 404 when no workflow exists for invoice', async () => {
      const invoiceId = 'inv_nonexistent_001';

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('No dunning workflow found for this invoice');
      expect(mockGetRun).not.toHaveBeenCalled();
    });

    it('returns 404 for empty invoice ID', async () => {
      const invoiceId = '';

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(404);
    });
  });

  describe('edge cases', () => {
    it('overwrites mapping when new workflow is registered for same invoice', async () => {
      const invoiceId = 'inv_multiple_001';

      // Register first workflow
      dunningStore.setInvoiceRunMapping({
        invoiceId,
        runId: 'run_old_001',
        customerId: 'cus_multiple_001',
        subscriptionId: 'sub_multiple_001',
      });

      // Register second workflow (overwrites)
      dunningStore.setInvoiceRunMapping({
        invoiceId,
        runId: 'run_new_001',
        customerId: 'cus_multiple_001',
        subscriptionId: 'sub_multiple_001',
      });

      mockGetRun.mockReturnValue(createMockRun({
        status: 'running',
      }) as ReturnType<typeof getRun>);

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.runId).toBe('run_new_001');
      expect(data.status).toBe('running');
      expect(mockGetRun).toHaveBeenCalledWith('run_new_001');
    });

    it('omits completedAt when workflow is still running', async () => {
      const runId = 'run_running_001';
      const invoiceId = 'inv_running_001';

      dunningStore.setInvoiceRunMapping({
        invoiceId,
        runId,
        customerId: 'cus_running_001',
        subscriptionId: 'sub_running_001',
      });

      mockGetRun.mockReturnValue(createMockRun({
        status: 'running',
        completedAt: undefined,
      }) as ReturnType<typeof getRun>);

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.completedAt).toBeUndefined();
      expect(data.result).toBeUndefined();
    });

    it('handles failed workflow status', async () => {
      const runId = 'run_failed_001';
      const invoiceId = 'inv_failed_001';

      dunningStore.setInvoiceRunMapping({
        invoiceId,
        runId,
        customerId: 'cus_failed_001',
        subscriptionId: 'sub_failed_001',
      });

      mockGetRun.mockReturnValue(createMockRun({
        status: 'failed',
        completedAt: new Date(),
      }) as ReturnType<typeof getRun>);

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('failed');
      expect(data.result).toBeUndefined();
    });

    it('handles pending workflow status', async () => {
      const runId = 'run_pending_001';
      const invoiceId = 'inv_pending_001';

      dunningStore.setInvoiceRunMapping({
        invoiceId,
        runId,
        customerId: 'cus_pending_001',
        subscriptionId: 'sub_pending_001',
      });

      mockGetRun.mockReturnValue(createMockRun({
        status: 'pending',
        startedAt: undefined,
        completedAt: undefined,
      }) as ReturnType<typeof getRun>);

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('pending');
      expect(data.startedAt).toBeUndefined();
      expect(data.completedAt).toBeUndefined();
    });

    it('handles cancelled workflow status', async () => {
      const runId = 'run_cancelled_001';
      const invoiceId = 'inv_cancelled_001';

      dunningStore.setInvoiceRunMapping({
        invoiceId,
        runId,
        customerId: 'cus_cancelled_001',
        subscriptionId: 'sub_cancelled_001',
      });

      mockGetRun.mockReturnValue(createMockRun({
        status: 'cancelled',
        completedAt: new Date(),
      }) as ReturnType<typeof getRun>);

      const request = createMockRequest(invoiceId);
      const response = await GET(request, createRouteParams(invoiceId));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe('cancelled');
    });
  });
});
